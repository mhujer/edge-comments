#!/usr/bin/env bash
#
# Guided, idempotent production deploy. Every run checks every stage, asks only
# for what's missing or invalid, then deploys. ./deploy.sh --reconfigure asks
# the token, account and config questions again, with current values as defaults.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

# shellcheck source=scripts/lib/wizard.sh
source scripts/lib/wizard.sh
# shellcheck source=scripts/lib/cloudflare.sh
source scripts/lib/cloudflare.sh

usage() {
  printf 'Usage: ./deploy.sh [--reconfigure]\n'
}

reconfigure=false
ci_log=tmp/deploy-ci.log
planned=()            # stages expected to need input on this run
banner_shown=false

# ── Stage helpers ────────────────────────────────────────────────────────

# needs_input WHAT fails clearly when there's no terminal to ask in.
needs_input() {
  [[ -t 0 ]] || fail "./deploy.sh needs input to $1, but stdin is not a terminal. Run it in a terminal."
}

is_planned() {
  local name
  for name in "${planned[@]}"; do [[ $name == "$1" ]] && return 0; done
  return 1
}

# enter_stage ID "Title" "what the input is for" starts a stage that needs input.
enter_stage() {
  needs_input "$3"
  is_planned "$1" || TOTAL_STAGES=$((TOTAL_STAGES + 1))
  if ! $banner_shown; then
    banner_shown=true
    banner "edge-comments deploy"
  fi
  stage "$2"
}

# skip_stage ID drops a planned stage that turned out to need no input.
skip_stage() {
  if is_planned "$1"; then
    TOTAL_STAGES=$((TOTAL_STAGES - 1))
    local kept=() name
    for name in "${planned[@]}"; do [[ $name == "$1" ]] || kept+=("$name"); done
    planned=("${kept[@]}")
  fi
}

# ask_default KEY "Prompt" DEFAULT [HINT] reads KEY with Readline, Enter taking DEFAULT.
# HINT says what Enter does: "keeps current" for a saved value, "accepts" for a suggestion.
ask_default() {
  local key=$1 prompt=$2 default=$3 hint=${4:-keeps current} input='' s=$'\001' e=$'\002' p
  # Readline needs the colour codes wrapped in \001..\002 to place the cursor.
  p="  $s$BOLD$e$prompt$s$RESET$e "
  [[ -z $default ]] || p+="($default) $s$DIM${e}[Enter $hint]$s$RESET$e "
  read -e -r -p "$p" input || [[ -n $input ]] || fail 'No input. Stopping.'
  printf -v "$key" '%s' "${input:-$default}"
}

# ── 1. Preflight ─────────────────────────────────────────────────────────

preflight() {
  local tool changes
  for tool in node git bash curl jq; do
    command -v "$tool" >/dev/null || fail "Install $tool before running ./deploy.sh."
  done
  (( $(node -p 'process.versions.node.split(".")[0]') >= 24 )) || fail 'Use Node 24 or newer.'
  changes=$(git status --porcelain --untracked-files=all)
  [[ -z $changes ]] || fail 'Deployment requires a clean Git working tree.'
  mkdir -p "$(dirname "$ci_log")"
  : >"$ci_log"
  printf '\n%sPreflight: running CI (install, check, e2e). This takes a few minutes.%s\n' "$BOLD" "$RESET"
  note "Output goes to $ci_log."
  run_ci_step 'npm ci' npm ci
  run_ci_step 'Playwright Chromium' npx playwright install chromium
  run_ci_step 'npm run check' npm run check
  run_ci_step 'npm run test:e2e' npm run test:e2e
}

# run_ci_step "Label" COMMAND... runs one CI step with its output in the CI log.
run_ci_step() {
  local label=$1
  shift
  printf '\n$ %s\n' "$*" >>"$ci_log"
  if ! "$@" >>"$ci_log" 2>&1; then
    warn "$label failed. Last lines of $ci_log:"
    tail -n 40 "$ci_log"
    fail "Fix the failure and run ./deploy.sh again. Full output: $ci_log"
  fi
  printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$label"
}

# Work out which stages need input, so progress counts only those.
plan_stages() {
  local sites
  planned=()
  load_env
  if ! token_ready; then
    planned=(token prerequisites config email site)
  else
    ! $reconfigure || planned+=(token)
    if ! has_active_zone || ! r2_enabled || ! access_team_domain >/dev/null || ! find_otp_provider; then
      planned+=(prerequisites config email site)
    else
      ensure_config_file
      load_config
      if ! config_valid; then
        planned+=(config email)
      else
        ! $reconfigure || planned+=(config)
        destination_verified "$admin_email" 2>/dev/null || planned+=(email)
      fi
      if [[ -z $(d1_database_id 2>/dev/null) ]] ||
        ! sites=$(remote_sites 2>/dev/null) || [[ $sites == '[]' ]]; then
        planned+=(site)
      fi
    fi
  fi
  TOTAL_STAGES=${#planned[@]}
}

# ── 2. API token and account ─────────────────────────────────────────────

# choose_account ACCOUNTS_JSON sets CLOUDFLARE_ACCOUNT_ID, asking only between several accounts.
choose_account() {
  local accounts=$1 count index choice
  count=$(jq 'length' <<<"$accounts")
  if (( count == 1 )); then
    CLOUDFLARE_ACCOUNT_ID=$(jq -r '.[0].id' <<<"$accounts")
  else
    jq -r 'to_entries[] | "  \(.key + 1). \(.value.name) (\(.value.id))"' <<<"$accounts"
    index=$(jq -r --arg id "$CLOUDFLARE_ACCOUNT_ID" 'map(.id) | index($id) // empty | . + 1' <<<"$accounts")
    while :; do
      ask_default ACCOUNT_CHOICE 'Account number:' "$index"
      choice=$ACCOUNT_CHOICE
      if [[ $choice =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= count )); then
        CLOUDFLARE_ACCOUNT_ID=$(jq -r --argjson i "$((choice - 1))" '.[$i].id' <<<"$accounts")
        break
      fi
      warn "Enter a number from 1 to $count."
    done
  fi
  write_env CLOUDFLARE_ACCOUNT_ID "$CLOUDFLARE_ACCOUNT_ID"
  export CLOUDFLARE_ACCOUNT_ID
}

# print_permissions SCOPE lists the SCOPE rows of the token permission table in docs/self-hosting.md.
print_permissions() {
  awk -F'|' -v scope="$1" '$2 ~ "^ " scope " +$" {
    gsub(/^ +| +$/, "", $3); gsub(/^ +| +$/, "", $4)
    printf "      %-54s %s\n", $3, $4
  }' docs/self-hosting.md
}

stage_token() {
  local accounts
  load_env
  if ! $reconfigure && token_ready; then
    skip_stage token
    return
  fi
  # A valid token with a missing or stale account only needs the account.
  if ! $reconfigure && verify_token; then
    accounts=$(list_accounts | jq -sc '.') || fail 'Could not list the accounts for this token.'
    if [[ $(jq 'length' <<<"$accounts") == 1 ]]; then
      choose_account "$accounts"
      skip_stage token
      return
    elif [[ $(jq 'length' <<<"$accounts") -gt 1 ]]; then
      enter_stage token 'Cloudflare account' 'pick a Cloudflare account'
      choose_account "$accounts"
      return
    fi
  fi
  enter_stage token 'Cloudflare API token' 'enter a Cloudflare API token'
  say 'Create a custom API token for ./deploy.sh. It is stored in the git-ignored .env.'
  open_url 'https://dash.cloudflare.com/profile/api-tokens'
  note 'From the dashboard home: profile icon (top right) → Profile → API Tokens.'
  step 'Click Create Token, then Start from scratch, and name it edge-comments.'
  step 'Start with an Account policy for your account, with these permissions:'
  print_permissions Account
  step 'Add a policy: Start with a Zone policy for the zone of the Worker hostname, with these permissions:'
  print_permissions Zone
  step 'Review the summary, then create the token and copy it.'
  note 'The summary also lists Read for most Edit permissions. That is expected.'
  while :; do
    ask_secret CLOUDFLARE_API_TOKEN 'Paste the API token:' || fail 'No input. Stopping.'
    export CLOUDFLARE_API_TOKEN
    if ! verify_token; then
      warn 'Cloudflare did not accept this token as active. Copy it again.'
      continue
    fi
    accounts=$(list_accounts | jq -sc '.') || fail 'Could not list the accounts for this token.'
    [[ $(jq 'length' <<<"$accounts") != 0 ]] && break
    warn 'This token sees no account. Check that its Account policy covers your account.'
  done
  write_env CLOUDFLARE_API_TOKEN "$CLOUDFLARE_API_TOKEN"
  choose_account "$accounts"
}

# ── 3. Dashboard prerequisites ───────────────────────────────────────────

prerequisite_passes() {
  case $1 in
    zone) has_active_zone ;;
    r2) r2_enabled ;;
    zero_trust) access_team_domain >/dev/null ;;
    otp) find_otp_provider ;;
  esac
}

explain_prerequisite() {
  case $1 in
    zone)
      say 'The account needs an active DNS zone for the Worker hostname.'
      open_url "https://dash.cloudflare.com/$CLOUDFLARE_ACCOUNT_ID/add-site"
      note 'From the dashboard home: Account home → Domains → Add a domain (or Onboard a domain).'
      step 'Enter your domain and pick the Free plan.'
      step 'Change the nameservers at your registrar to the ones Cloudflare shows.'
      step 'Wait until the zone shows Active. That can take a while.'
      note 'If the zone is already active, edit the API token so its Zone policy covers it.'
      ;;
    r2)
      say 'R2 must be activated for the weekly backups, even on the free allowance.'
      open_url "https://dash.cloudflare.com/$CLOUDFLARE_ACCOUNT_ID/r2/overview"
      note 'From the dashboard home: Storage & databases → R2 Object Storage.'
      step 'Start the R2 subscription (Purchase R2 or Add R2 subscription).'
      step 'Add a payment card and complete checkout.'
      ;;
    zero_trust)
      say 'Zero Trust must be activated: Access protects /admin.'
      open_url "https://one.dash.cloudflare.com/$CLOUDFLARE_ACCOUNT_ID"
      note 'From the dashboard home: Zero Trust in the left sidebar, then pick this account.'
      step 'Choose a team name and the Free plan.'
      step 'Add a payment card and complete checkout (required even on Free).'
      ;;
    otp)
      say 'Access signs the Admin in with a One-time PIN, which is not enabled yet.'
      open_url "https://one.dash.cloudflare.com/$CLOUDFLARE_ACCOUNT_ID/integrations/identity-providers"
      note 'From the dashboard home: Zero Trust → Integrations → Identity providers.'
      step 'Choose Add new identity provider, then One-time PIN.'
      step 'There is no Save button: click ← Back to Identity Providers.'
      ;;
  esac
}

stage_prerequisites() {
  local check failing=()
  for check in zone r2 zero_trust otp; do
    prerequisite_passes "$check" || failing+=("$check")
  done
  if (( ${#failing[@]} == 0 )); then
    skip_stage prerequisites
    return
  fi
  enter_stage prerequisites 'Cloudflare dashboard prerequisites' 'finish the dashboard prerequisites'
  for check in "${failing[@]}"; do
    explain_prerequisite "$check"
    until prerequisite_passes "$check"; do
      pause 'Press Enter to check again.'
      prerequisite_passes "$check" || warn 'Not done yet.'
    done
    printf '  %s✓ done%s\n\n' "$GREEN" "$RESET"
  done
}

# ── 4. Config values ─────────────────────────────────────────────────────

config_valid() {
  local expected_team
  expected_team=$(access_team_domain) || return 1
  valid_custom_domain "$custom_domain" &&
    valid_team_domain "$team_domain" "$expected_team" &&
    valid_admin_email "$admin_email"
}

# ask_config_value VAR "Prompt" DEFAULT HINT "Warning" VALIDATOR [ARG] asks until the validator accepts.
ask_config_value() {
  local key=$1 prompt=$2 default=$3 hint=$4 warning=$5 validator=$6 arg=${7:-}
  while :; do
    ask_default "$key" "$prompt" "$default" "$hint"
    if "$validator" "${!key}" "$arg"; then return; fi
    warn "$warning"
  done
}

stage_config() {
  local expected_team zones hint saved_hint='keeps current' ask_all=$reconfigure
  ensure_config_file
  load_config
  expected_team=$(access_team_domain) || fail 'Could not read the Zero Trust team hostname.'
  if ! $reconfigure && config_valid; then
    apply_config
    skip_stage config
    return
  fi
  enter_stage config 'Worker configuration' 'set the Worker configuration'
  say "These values go into $config_file."
  # Enter keeps a value saved in the config. After a No at the review, nothing is saved yet.
  while :; do
    if $ask_all || ! valid_custom_domain "$custom_domain"; then
      zones=$(list_zones | paste -sd ' ' -)
      note "Active zones this token can use: $zones"
      hint=$saved_hint
      if ! valid_custom_domain "$custom_domain"; then
        custom_domain=comments.${zones%% *}
        hint=accepts
      fi
      ask_config_value custom_domain 'Worker hostname, without https://:' "$custom_domain" "$hint" \
        'Use a subdomain in an active zone this token can use, not the zone itself.' valid_custom_domain
      find_zone "$custom_domain"
    fi
    if $ask_all || ! valid_team_domain "$team_domain" "$expected_team"; then
      note "Access reports the team hostname $expected_team."
      hint=$saved_hint
      [[ $team_domain == "$expected_team" ]] || hint=accepts
      ask_config_value team_domain 'Zero Trust team hostname:' "$expected_team" "$hint" \
        "Use the team hostname Access reports: $expected_team." valid_team_domain "$expected_team"
    fi
    if $ask_all || ! valid_admin_email "$admin_email"; then
      note 'The Admin signs in and gets notifications at this address.'
      valid_admin_email "$admin_email" || admin_email=
      ask_config_value admin_email 'Admin email:' "$admin_email" "$saved_hint" \
        'Enter a valid email address.' valid_admin_email
    fi
    say ''
    say "CUSTOM_DOMAIN       $custom_domain"
    say "ACCESS_TEAM_DOMAIN  $team_domain"
    say "ADMIN_EMAIL         $admin_email"
    say "EMAIL_FROM          edge-comments@$custom_domain (always)"
    confirm "Write these values to $config_file?" && break
    ask_all=true
    saved_hint=accepts
  done
  apply_config
}

# ── 6. Email Routing and destination ─────────────────────────────────────

stage_email() {
  ensure_email_routing
  ensure_destination "$admin_email"
  if $destination_is_verified; then
    skip_stage email
    return
  fi
  # Only notification emails need the address verified, so a run without a terminal deploys anyway.
  if [[ ! -t 0 ]]; then
    skip_stage email
    SKIPPED+=("Verify $admin_email: click the link in the Cloudflare email, or notifications won't arrive")
    warn "$admin_email is not verified yet. Deploying anyway; notification emails fail until it is."
    return
  fi
  enter_stage email 'Verify the Admin email' "wait for $admin_email to be verified"
  say "Cloudflare sent a verification email to $admin_email."
  step 'Open it and click the verification link.'
  while :; do
    ask_default EMAIL_REPLY 'Press Enter to check again, or type s to skip:' ''
    if [[ $EMAIL_REPLY == [sS] ]]; then
      SKIPPED+=("Verify $admin_email: click the link in the Cloudflare email, or notifications won't arrive")
      warn 'Skipped. Notification emails fail until the address is verified.'
      return
    fi
    if destination_verified "$admin_email"; then
      printf '  %s✓ verified%s\n' "$GREEN" "$RESET"
      return
    fi
    warn 'Not verified yet.'
  done
}

# ── 8. First Site ────────────────────────────────────────────────────────

stage_first_site() {
  local sites
  sites=$(remote_sites)
  if [[ $sites != '[]' ]]; then
    skip_stage site
    return
  fi
  enter_stage site 'First Site' 'create the first Site'
  say 'A Site is a website that embeds the widget. Add more Sites later in the Admin.'
  npm run -s create-site
}

# ── 13. Summary and 14. optional Disqus import ───────────────────────────

summary() {
  local sites
  sites=$(remote_sites)
  finish
  say "Admin: https://$custom_domain/admin (sign in with the One-time PIN sent to $admin_email)"
  say ''
  jq -r '.[] | "  \(.name) (default language \(.language)): \(.origins | join(", ") | if . == "" then "no Allowed origins" else . end)"' <<<"$sites"
  say ''
  say 'Embed the widget where comments should appear, once per page:'
  say '  <div id="edge-comments"></div>'
  say "  <script src=\"https://$custom_domain/widget.js\" async></script>"
  say 'Optional attributes on the div:'
  say '  data-lang="en" or "cs"   overrides the Site default language on that page.'
  say '  data-page-key="/path"    a stable key instead of the URL path, e.g. after a post moves.'
  say "The page's <title> becomes the Page title in the Admin and in notification emails."
  say 'Each Site page in the Admin shows the same instructions. Details: docs/self-hosting.md.'
  say ''
  say 'If a host page has a Content Security Policy, add these to it (see docs/self-hosting.md):'
  say "  script-src   https://$custom_domain https://challenges.cloudflare.com"
  say "  connect-src  https://$custom_domain"
  say '  frame-src    https://challenges.cloudflare.com'
  say ''
  say 'After adding a Site or changing Allowed origins in the Admin, run ./deploy.sh again.'
  say ''
}

# offer_import offers a Disqus import while production has no Comments yet.
offer_import() {
  local sites site_id site_name count index
  [[ -t 0 ]] || return 0
  sites=$(remote_sites)
  count=$(jq 'length' <<<"$sites")
  (( count )) && [[ $(remote_comment_count) == 0 ]] || return 0
  if ! confirm 'Import Comments from a Disqus export now?'; then
    note 'Import later with: npm run import:disqus -- <export.xml> --target remote'
    note 'Review the dry run, then repeat the command with --apply.'
    return 0
  fi
  index=1
  if (( count > 1 )); then
    jq -r 'to_entries[] | "  \(.key + 1). \(.value.name)"' <<<"$sites"
    while :; do
      ask_default index 'Import into Site number:' ''
      [[ $index =~ ^[0-9]+$ ]] && (( index >= 1 && index <= count )) && break
      warn "Enter a number from 1 to $count."
    done
  fi
  site_id=$(jq -r --argjson i "$index" '.[$i - 1].id' <<<"$sites")
  site_name=$(jq -r --argjson i "$index" '.[$i - 1].name' <<<"$sites")
  while :; do
    ask_default DISQUS_EXPORT 'Path to the Disqus XML export:' ''
    [[ -f $DISQUS_EXPORT ]] && break
    warn "$DISQUS_EXPORT is not a file."
  done
  say "Importing into $site_name. Dry run first:"
  npm run import:disqus -- "$DISQUS_EXPORT" --site "$site_id" --target remote
  if confirm 'Apply this import to the production database?'; then
    npm run import:disqus -- "$DISQUS_EXPORT" --site "$site_id" --target remote --apply
  else
    note "Skipped. Apply it later with: npm run import:disqus -- $DISQUS_EXPORT --site $site_id --target remote --apply"
  fi
}

# ── Stages ───────────────────────────────────────────────────────────────

main() {
  local arg origins
  for arg; do
    case $arg in
      --reconfigure) reconfigure=true ;;
      -h | --help) usage; return ;;
      *) usage >&2; return 1 ;;
    esac
  done

  preflight
  plan_stages
  stage_token
  stage_prerequisites
  stage_config
  ensure_d1
  ensure_r2
  stage_email
  apply_migrations
  stage_first_site
  origins=$(remote_sites | jq -c '[.[].origins[]]')
  ensure_turnstile "$origins"
  find_otp_provider || fail 'Enable the One-time PIN login method in your Zero Trust team.'
  ensure_access_app
  write_secrets
  deploy_worker
  summary
  offer_import
}

main "$@"; exit

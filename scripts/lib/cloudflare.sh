# shellcheck shell=bash
#
# Idempotent Cloudflare provisioning for ./deploy.sh. Each ensure_* function
# creates or updates one resource only when it differs from the desired state.
# Functions use CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, and set the
# result variables named in their comments.

config_file=wrangler.jsonc
wrangler=node_modules/.bin/wrangler
secrets_file=.wrangler/secrets.production.json
hostname_pattern='^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
email_pattern='^[^@[:space:]]+@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]*[a-z0-9])?$'

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

# load_env reads the Cloudflare credentials from .env, keeping unset ones empty.
load_env() {
  local credentials='{}'
  if [[ -f .env ]]; then
    credentials=$(node -e '
      const { readFileSync } = require("node:fs");
      const { parseEnv } = require("node:util");
      const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID } = parseEnv(readFileSync(".env", "utf8"));
      process.stdout.write(JSON.stringify({ CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID }));
    ') || return
  fi
  CLOUDFLARE_API_TOKEN=$(jq -r '.CLOUDFLARE_API_TOKEN // empty' <<<"$credentials")
  CLOUDFLARE_ACCOUNT_ID=$(jq -r '.CLOUDFLARE_ACCOUNT_ID // empty' <<<"$credentials")
  export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
}

account() {
  printf '/accounts/%s' "$CLOUDFLARE_ACCOUNT_ID"
}

# api METHOD PATH [curl args...] prints the JSON response, or the API errors and fails.
api() {
  local method=$1 path=$2 response
  shift 2
  response=$(curl --silent --show-error --connect-timeout 10 --max-time 60 \
    --request "$method" --header @- "$@" "https://api.cloudflare.com/client/v4$path" \
    <<<"Authorization: Bearer $CLOUDFLARE_API_TOKEN") || return
  if ! jq -e '.success == true' <<<"$response" >/dev/null 2>&1; then
    printf 'Cloudflare API %s %s failed.\n' "$method" "$path" >&2
    jq -r '.errors[]? | "[\(.code)] \(.message)"' <<<"$response" >&2 2>/dev/null || true
    return 1
  fi
  printf '%s\n' "$response"
}

# list_resources PATH prints one JSON object per line from an endpoint that
# paginates with page numbers.
list_resources() {
  local path=$1 page=1 separator='?' response result total
  [[ $path == *\?* ]] && separator='&'
  while :; do
    response=$(api GET "$path${separator}per_page=50&page=$page") || return
    result=$(jq -ce '.result | arrays' <<<"$response") || return
    jq -c '.[]' <<<"$result" || return
    total=$(jq -r '.result_info.total_pages // 0' <<<"$response") || return
    if (( total > 0 )); then
      (( page < total )) || break
    else
      [[ $(jq 'length' <<<"$result") == 50 ]] || break
    fi
    page=$((page + 1))
  done
}

# ── Token and account ────────────────────────────────────────────────────

# list_accounts prints {id, name} per account the token can see.
list_accounts() {
  list_resources /accounts | jq -c '{id, name}'
}

# verify_token succeeds when the token is active, as a user or account token.
verify_token() {
  local id
  [[ -n $CLOUDFLARE_API_TOKEN ]] || return 1
  if api GET /user/tokens/verify 2>/dev/null | jq -e '.result.status == "active"' >/dev/null; then
    return 0
  fi
  for id in $(list_accounts 2>/dev/null | jq -r '.id'); do
    if api GET "/accounts/$id/tokens/verify" 2>/dev/null |
      jq -e '.result.status == "active"' >/dev/null; then
      return 0
    fi
  done
  return 1
}

# token_ready succeeds when .env holds an active token and an account it can see.
token_ready() {
  [[ -n $CLOUDFLARE_API_TOKEN && -n $CLOUDFLARE_ACCOUNT_ID ]] || return 1
  verify_token || return 1
  list_accounts 2>/dev/null | jq -se --arg id "$CLOUDFLARE_ACCOUNT_ID" 'any(.[]; .id == $id)' >/dev/null
}

# ── Dashboard prerequisites ──────────────────────────────────────────────

# zone_usable ZONE_ID succeeds when the token's Zone permissions cover the zone.
# Account permissions let a token list zones it can't edit, so this reads DNS records instead.
zone_usable() {
  api GET "/zones/$1/dns_records?per_page=1" >/dev/null 2>&1
}

# list_zones prints the names of the active zones in the account the token can use.
list_zones() {
  local id name
  list_resources "/zones?status=active&account.id=$CLOUDFLARE_ACCOUNT_ID" | jq -r '[.id, .name] | @tsv' |
    while IFS=$'\t' read -r id name; do
      if zone_usable "$id"; then printf '%s\n' "$name"; fi
    done
}

has_active_zone() {
  [[ -n $(list_zones 2>/dev/null) ]]
}

r2_enabled() {
  api GET "$(account)/r2/buckets?per_page=1" >/dev/null 2>&1
}

# access_team_domain prints the Zero Trust team hostname; it fails before Zero Trust is activated.
access_team_domain() {
  api GET "$(account)/access/organizations" 2>/dev/null |
    jq -er '.result.auth_domain | strings | select(length > 0)'
}

# find_otp_provider sets otp_id to the One-time PIN login method.
find_otp_provider() {
  otp_id=$(list_resources "$(account)/access/identity_providers" 2>/dev/null |
    jq -sr 'first(.[] | select(.type == "onetimepin").id) // empty') || return
  [[ -n $otp_id ]]
}

# ── Wrangler config ──────────────────────────────────────────────────────

ensure_config_file() {
  if [[ ! -f $config_file ]]; then
    cp wrangler.example.jsonc "$config_file"
    printf 'Created %s from the example.\n' "$config_file"
  fi
}

# Use Wrangler's JSONC parser and editor so comments and additional bindings survive.
read_config() {
  node --input-type=module -e '
    import { experimental_readRawConfig } from "wrangler";
    const { rawConfig } = experimental_readRawConfig({ config: process.argv[1] });
    process.stdout.write(JSON.stringify(rawConfig));
  ' "$config_file"
}

patch_config() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    import { experimental_patchConfig } from "wrangler";
    experimental_patchConfig(process.argv[1], JSON.parse(readFileSync(0, "utf8")), false);
  ' "$config_file"
}

# load_config sets config, worker_name and the configurable vars from wrangler.jsonc.
load_config() {
  config=$(read_config) || return
  worker_name=$(jq -er '.name' <<<"$config") || return
  custom_domain=$(jq -r '.vars.CUSTOM_DOMAIN // empty' <<<"$config")
  team_domain=$(jq -r '.vars.ACCESS_TEAM_DOMAIN // empty' <<<"$config")
  admin_email=$(jq -r '.vars.ADMIN_EMAIL // empty' <<<"$config")
}

# find_zone HOSTNAME sets zone_id and zone_name to the most specific active zone containing it.
find_zone() {
  local name=$1 zone
  zone_id=
  zone_name=
  while [[ $name == *.* ]]; do
    zone=$(api GET "/zones?name=$name&status=active&account.id=$CLOUDFLARE_ACCOUNT_ID") || return
    zone_id=$(jq -r --arg name "$name" '.result[] | select(.name == $name).id' <<<"$zone")
    if [[ -n $zone_id ]]; then
      zone_name=$name
      return 0
    fi
    name=${name#*.}
  done
  return 1
}

# valid_custom_domain HOSTNAME needs a subdomain of a usable zone: Email Routing runs on it, not the apex.
valid_custom_domain() {
  [[ $1 =~ $hostname_pattern && $1 != comments.example.com ]] && find_zone "$1" 2>/dev/null &&
    [[ $1 != "$zone_name" ]] && zone_usable "$zone_id"
}

# valid_team_domain VALUE [EXPECTED] also requires the team hostname Access reports, when known.
valid_team_domain() {
  [[ $1 =~ $hostname_pattern && $1 != your-team.cloudflareaccess.com ]] &&
    [[ -z ${2:-} || $1 == "$2" ]]
}

valid_admin_email() {
  [[ ${1,,} =~ $email_pattern && ${1,,} != admin@example.com ]]
}

# apply_config writes the vars and the matching route and send_email binding.
# EMAIL_FROM is always edge-comments@<Worker hostname>, so hand edits are overwritten.
apply_config() {
  local patch
  patch=$(jq -c --arg domain "$custom_domain" --arg team "$team_domain" \
    --arg admin "$admin_email" --arg from "edge-comments@$custom_domain" '
    . as $original
    | { routes: [{ pattern: $domain, custom_domain: true }],
        send_email: [{ name: "EMAIL", destination_address: $admin }],
        vars: { CUSTOM_DOMAIN: $domain, ACCESS_TEAM_DOMAIN: $team,
          ADMIN_EMAIL: $admin, EMAIL_FROM: $from } }
    | select(.routes != $original.routes or .send_email != $original.send_email
      or (.vars | to_entries | any(.value != $original.vars[.key])))
  ' <<<"$config") || return
  if [[ -n $patch ]]; then
    patch_config <<<"$patch" || return
    printf 'Updated %s.\n' "$config_file"
  fi
  load_config
}

# ── D1 and R2 ────────────────────────────────────────────────────────────

d1_database_name() {
  jq -er '.d1_databases[] | select(.binding == "DB").database_name | select(length > 0)' <<<"$config"
}

# d1_database_id prints the UUID of the configured DB database, if it exists.
d1_database_id() {
  local name databases
  name=$(d1_database_name) || return
  databases=$("$wrangler" d1 list --json --config "$config_file") || return
  jq -r --arg name "$name" '.[] | select(.name == $name).uuid' <<<"$databases"
}

ensure_d1() {
  local database_name database_id binding
  database_name=$(d1_database_name) || return
  database_id=$(d1_database_id) || return
  if [[ -z $database_id ]]; then
    "$wrangler" d1 create "$database_name" --binding DB --update-config --config "$config_file" || return
  else
    binding=$(jq -c --arg id "$database_id" '
      .d1_databases as $original
      | {d1_databases: ($original | map(if .binding == "DB" then .database_id = $id else . end))}
      | select(.d1_databases != $original)
    ' <<<"$config") || return
    if [[ -n $binding ]]; then
      patch_config <<<"$binding" || return
    fi
    printf 'D1 database %s already exists.\n' "$database_name"
  fi
  load_config
}

ensure_r2() {
  local bucket_name bucket_query bucket_cursor='' buckets cursor
  bucket_name=$(jq -er '.r2_buckets[] | select(.binding == "BACKUPS").bucket_name | select(length > 0)' <<<"$config") || return
  bucket_query=$(jq -nr --arg name "$bucket_name" '$name | @uri')
  while :; do
    buckets=$(api GET "$(account)/r2/buckets?name_contains=$bucket_query&per_page=1000$bucket_cursor") || return
    if jq -e --arg name "$bucket_name" 'any(.result.buckets[]; .name == $name)' <<<"$buckets" >/dev/null; then
      printf 'R2 bucket %s already exists.\n' "$bucket_name"
      break
    fi
    cursor=$(jq -r '.result_info.cursor // empty | @uri' <<<"$buckets")
    if [[ -z $cursor ]]; then
      "$wrangler" r2 bucket create "$bucket_name" --binding BACKUPS --update-config --config "$config_file" || return
      break
    fi
    bucket_cursor="&cursor=$cursor"
  done
  load_config
}

# d1_query SQL prints the result rows of a remote query as one JSON array.
d1_query() {
  "$wrangler" d1 execute DB --remote --json --config "$config_file" --command "$1" |
    jq -c '[.[].results[]]'
}

apply_migrations() {
  "$wrangler" d1 migrations apply DB --remote --config "$config_file"
}

# remote_comment_count prints how many Comments the production database holds.
remote_comment_count() {
  d1_query 'SELECT count(*) AS comments FROM comment' | jq -er '.[0].comments'
}

# remote_table_exists TABLE checks for the table without swallowing D1 errors.
remote_table_exists() {
  local tables
  tables=$(d1_query "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = '$1'") || return 2
  jq -e --arg name "$1" 'any(.[]; .name == $name)' <<<"$tables" >/dev/null
}

# remote_sites prints the Sites as [{id, name, language, origins: [...]}], or [] before migrations.
remote_sites() {
  local status=0
  remote_table_exists site_origin || status=$?
  (( status != 2 )) || return 1
  if (( status == 1 )); then
    printf '[]\n'
    return
  fi
  d1_query "SELECT site.id, site.name, site.default_language AS language, (SELECT json_group_array(origin) FROM
      (SELECT origin FROM site_origin WHERE site_id = site.id ORDER BY origin)) AS origins
    FROM site ORDER BY site.name COLLATE NOCASE, site.id" |
    jq -c 'map(.origins |= fromjson)'
}

# ── Email Routing ────────────────────────────────────────────────────────

# ensure_email_routing enables Email Routing on the Worker hostname, never on the zone apex,
# so the apex keeps its own MX records (docs/adr/0001). Needs zone_id and custom_domain.
ensure_email_routing() {
  local dns="/zones/$zone_id/email/routing/dns" missing
  # The DNS check lists one error per record the subdomain still lacks.
  missing=$(api GET "$dns?subdomain=$custom_domain" | jq -er '.result.errors // [] | length') || return
  if (( missing == 0 )); then
    printf 'Email Routing is already enabled for %s.\n' "$custom_domain"
  else
    api POST "$dns" --json "$(jq -cn --arg name "$custom_domain" '{name: $name}')" >/dev/null || return
    printf 'Enabled Email Routing for %s.\n' "$custom_domain"
  fi
}

# find_destination EMAIL prints the Email Routing destination address, or null.
find_destination() {
  list_resources "$(account)/email/routing/addresses" | jq -sc --arg email "$1" '
    map(select((.email | ascii_downcase) == ($email | ascii_downcase))) | first // null
  '
}

destination_verified() {
  find_destination "$1" | jq -e '.verified' >/dev/null
}

# ensure_destination EMAIL creates the destination and sets destination_is_verified=true|false.
# shellcheck disable=SC2034 # read by deploy.sh
ensure_destination() {
  local destination
  destination=$(find_destination "$1") || return
  if [[ $destination == null ]]; then
    destination=$(api POST "$(account)/email/routing/addresses" \
      --json "$(jq -cn --arg email "$1" '{email: $email}')" | jq -c '.result') || return
    printf 'Created the Email Routing destination %s.\n' "$1"
  fi
  if jq -e '.verified' <<<"$destination" >/dev/null; then
    destination_is_verified=true
    printf 'Email Routing destination %s is verified.\n' "$1"
  else
    destination_is_verified=false
  fi
}

# ── Turnstile ────────────────────────────────────────────────────────────

# ensure_turnstile ORIGINS_JSON sets site_key and turnstile_secret for a widget
# listing the hostnames of all Allowed origins.
ensure_turnstile() {
  local origins=$1 domains widgets widget_name widget_body widget widget_matches
  domains=$(node -e '
    const origins = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    const hosts = [...new Set(origins.map((origin) => new URL(origin).hostname))].sort();
    process.stdout.write(JSON.stringify(hosts.length ? hosts : [process.argv[1]]));
  ' "$custom_domain" <<<"$origins") || return
  (( $(jq 'length' <<<"$domains") <= 10 )) || fail 'Turnstile supports at most 10 distinct Site hostnames.'
  if [[ $(jq 'length' <<<"$origins") == 0 ]]; then
    printf '\nWARNING: No Allowed origins yet. Turnstile lists only %s, so Comment\n' "$custom_domain" >&2
    printf 'submissions will fail until you add one and re-run ./deploy.sh.\n\n' >&2
  fi

  widgets="$(account)/challenges/widgets"
  widget_name="$worker_name ($custom_domain)"
  widget_body=$(jq -cn --arg name "$widget_name" --argjson domains "$domains" '
    {name: $name, mode: "managed", domains: $domains, clearance_level: "no_clearance"}
  ')
  site_key=$(list_resources "$widgets" | jq -sr --arg name "$widget_name" '
    map(select(.name == $name)) | if length > 1 then error("Multiple matching Turnstile widgets") else .[0].sitekey // empty end
  ') || return
  if [[ -z $site_key ]]; then
    widget=$(api POST "$widgets" --json "$widget_body") || return
    site_key=$(jq -er '.result.sitekey | select(length > 0)' <<<"$widget") || return
    printf 'Created the Turnstile widget.\n'
  else
    widget=$(api GET "$widgets/$site_key") || return
    widget_matches=$(jq -r --argjson desired "$widget_body" '
      .result | .mode == $desired.mode and (.domains | sort) == $desired.domains
        and (.clearance_level // "no_clearance") == $desired.clearance_level
    ' <<<"$widget")
    if [[ $widget_matches == false ]]; then
      api PUT "$widgets/$site_key" --json "$widget_body" >/dev/null || return
      printf 'Updated the Turnstile widget hostnames.\n'
    else
      printf 'Turnstile widget already matches the Site hostnames.\n'
    fi
  fi
  turnstile_secret=$(jq -er '.result.secret | select(length > 0)' <<<"$widget")
}

# ── Access ───────────────────────────────────────────────────────────────

# ensure_access_app sets access_aud for the path-scoped Access app on /admin,
# adapted from the one configured in the Free plan probe. Needs otp_id.
ensure_access_app() {
  local apps app_domain app_body app_id app app_matches
  apps="$(account)/access/apps"
  app_domain="$custom_domain/admin"
  app_body=$(jq -cn --arg domain "$app_domain" --arg name "$worker_name admin" \
    --arg email "$admin_email" --arg otp "$otp_id" '
    {
      type: "self_hosted",
      name: $name,
      domain: $domain,
      destinations: [{type: "public", uri: $domain}],
      session_duration: "24h",
      allowed_idps: [$otp],
      allow_authenticate_via_warp: false,
      same_site_cookie_attribute: "lax",
      http_only_cookie_attribute: true,
      enable_binding_cookie: false,
      policies: [{
        name: "admin", decision: "allow", precedence: 1,
        include: [{email: {email: $email}}], require: [], exclude: []
      }]
    }
  ')
  app_id=$(list_resources "$apps" | jq -sr --arg domain "$app_domain" '
    map(select(.type == "self_hosted" and .domain == $domain))
    | if length > 1 then error("Multiple matching Access apps") else .[0].id // empty end
  ') || return
  if [[ -z $app_id ]]; then
    app=$(api POST "$apps" --json "$app_body") || return
    printf 'Created the Access app on %s.\n' "$app_domain"
  else
    app=$(api GET "$apps/$app_id") || return
    app_matches=$(jq -r --argjson desired "$app_body" '
      .result
      | .session_duration == $desired.session_duration
        and .name == $desired.name
        and ((.destinations // [{type: "public", uri: .domain}])
          | map({type, uri} + if (.overrides // [] | length) > 0 then {overrides} else {} end))
          == $desired.destinations
        and .allowed_idps == $desired.allowed_idps
        and (.allow_authenticate_via_warp // false) == false
        and ((.same_site_cookie_attribute // "") | ascii_downcase) == "lax"
        and .http_only_cookie_attribute == true
        and (.enable_binding_cookie // false) == false
        and ((.policies // []) | map({name, decision, precedence, include: .include,
          require: (.require // []), exclude: (.exclude // [])})) == $desired.policies
    ' <<<"$app")
    if [[ $app_matches == false ]]; then
      app=$(api PUT "$apps/$app_id" --json "$app_body") || return
      printf 'Updated the Access app on %s.\n' "$app_domain"
    else
      printf 'Access app already protects %s with the configured Admin policy.\n' "$app_domain"
    fi
  fi
  access_aud=$(jq -er '.result.aud | select(length > 0)' <<<"$app")
}

# ── Secrets and deploy ───────────────────────────────────────────────────

# write_secrets stages the Worker secrets for deploy_worker, which uploads and then deletes them.
# Wrangler secret put would deploy immediately.
write_secrets() {
  mkdir -p .wrangler
  staged_secrets=$(mktemp .wrangler/secrets.production.XXXXXX) || return
  trap 'rm -f "$staged_secrets"' EXIT
  chmod 600 "$staged_secrets"
  jq -Rn '[inputs] | {ACCESS_AUD: .[0], TURNSTILE_SITE_KEY: .[1], TURNSTILE_SECRET: .[2]}' \
    >"$staged_secrets" <<<"$access_aud"$'\n'"$site_key"$'\n'"$turnstile_secret" || return
  if [[ -f $secrets_file && ! -L $secrets_file ]] && cmp -s "$staged_secrets" "$secrets_file"; then
    chmod 600 "$secrets_file"
  else
    mv -f "$staged_secrets" "$secrets_file"
  fi
  printf 'Production secrets are ready in %s.\n' "$secrets_file"
}

refuse_auth_bypass() {
  if jq -e '.vars // {} | has("ADMIN_AUTH_BYPASS")' <<<"$config" >/dev/null; then
    fail "Remove ADMIN_AUTH_BYPASS from $config_file vars before deploying."
  fi
}

deploy_worker() {
  local deploy_args=(deploy --config "$config_file")
  refuse_auth_bypass
  npm run build:widget || return
  if [[ -f $secrets_file ]]; then
    deploy_args+=(--secrets-file "$secrets_file")
  fi
  "$wrangler" "${deploy_args[@]}" || return
  # Deploys keep uploaded secrets, so drop the plaintext copy. The next run stages it again.
  rm -f "$secrets_file"
}

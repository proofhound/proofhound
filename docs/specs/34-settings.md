# 34 · Settings

## 1. Page role

"Settings" is the access-credential management entry point of the open-source Local admin app. The current scope only covers:

- API token: used to authenticate Webhook requests.
- Global MCP token: used to authenticate the MCP channel, where the agent invokes local workspace capabilities as tools.

The settings page does not host project management, organizations, members, role permissions, browser login methods, approvals, audit logs, billing, instance monitoring, or alerting configuration. The open-source version still has only one default local project as the `project_id` Data boundary.

## 2. Page structure

The first version of `/settings` provides two side-by-side sections:

1. API token
2. Global MCP token

Both sections share the same Token security rules:

- List and summary interfaces only expose `prefix`; they never return plaintext.
- On successful creation, the plaintext is returned once, and the page should prompt the user to copy it promptly.
- Viewing the plaintext must be explicitly triggered by the user; the plaintext is only returned when `token_encrypted` is recoverable.
- Deleting a Token executes revocation semantics: it writes `revoked_at`, and the Token becomes invalid immediately; it is not physically deleted from the table.
- Token validation only uses `token_hash`; logs must never write the plaintext Token.
- The frontend displays all date-times consistently as `YYYY/MM/DD HH:mm:ss`.

## 3. API token

The API token is a project-level Token and must be bound to the current default local project. The open-source version allows multiple valid API tokens to exist simultaneously, for different Webhook callers.

### 3.1 List content

Each row displays:

- Token name.
- Token prefix.
- IP allowlist; when empty, the source IP is unrestricted.
- Last-used time.
- Expiry time; when empty, the Token never expires.
- Creation time.
- Actions: edit, view plaintext, copy plaintext, delete.

The list must not display the full plaintext Token. Before copying the full plaintext, the user must first explicitly obtain it via "View plaintext".

### 3.2 Creation

Form fields for creating an API token:

- Name: 2 to 80 characters, used to distinguish the external caller or purpose.
- IP allowlist: optional, supports IPv4 or IPv4/CIDR, with multiple entries.
- Expiry time: optional; the frontend may provide "Never expires / 7 days / 30 days / 90 days / Custom time" shortcuts.

After successful creation:

- The Token summary and plaintext are returned.
- The page displays the plaintext in a one-time result area and provides a copy button.
- The new Token immediately appears in the API token list.

### 3.3 View plaintext

After the user clicks "View plaintext", the frontend calls the plaintext-view interface:

- When `available=true`, display the plaintext and allow copying.
- When `available=false`, indicate that this Token is a legacy hash-only record whose plaintext cannot be recovered, and the user needs to create a new one.

The plaintext area is collapsible by default; the plaintext state is not retained after switching pages or refreshing.

### 3.4 Editing

The API token supports editing:

- Token name.
- Expiry time; it can be changed to never expire, a custom expiry time, or a new relative time via shortcut.

Editing does not change the Token plaintext, prefix, hash, IP allowlist, last-used time, or creation time.

### 3.5 Deletion

Before deleting an API token, a confirmation dialog must be shown, explaining that the Token becomes invalid immediately after deletion and that external business systems need to switch to a new Token.

After successful deletion:

- The backend writes `revoked_at`.
- The list no longer displays the Token.
- Webhook input connectors bound to the Token fail authentication on subsequent calls; the connector page can display the status that the associated Token is missing or invalid.

## 4. Global MCP token

The Global MCP token is not bound to a project and is used for MCP entry-point authentication. The open-source version allows at most one valid Global MCP token at a time.

### 4.1 List content

The Global MCP token section uses a list in the same style as the API token. The current open-source version allows at most one valid Global MCP token at a time, so the list has at most one row.

Each row displays:

- Token name.
- Token prefix.
- Last-used time.
- Expiry time; when empty, the Token never expires.
- Creation time.
- Actions: edit, view plaintext, copy plaintext, delete.

When a valid Global MCP token already exists, the page does not display a second creation entry; the user must first delete the current Token, then create a new one.

### 4.2 Creation

Form fields for creating a Global MCP token:

- Name: 2 to 80 characters.
- Expiry time: optional.

After successful creation:

- The Token summary and plaintext are returned.
- The page displays the one-time plaintext result and provides a copy button.
- The MCP client needs to use the new Token to invoke MCP tools.

### 4.3 View plaintext

The viewing rules are consistent with the API token:

- The plaintext is only requested when explicitly triggered by the user.
- When `available=false`, indicate that the plaintext cannot be recovered and the Token must be deleted and recreated.

### 4.4 Editing

The Global MCP token supports editing:

- Token name.
- Expiry time.

Editing does not change the Token plaintext, prefix, hash, last-used time, or creation time.

### 4.5 Deletion

Before deleting the Global MCP token, a confirmation dialog must be shown, explaining that all MCP clients become invalid immediately after deletion.

After successful deletion:

- The backend writes `revoked_at`.
- The summary area returns to the not-created state.
- MCP requests using the old Token must fail authentication.

## 5. REST / MCP contracts

The settings page reuses the Token module's REST interfaces (a single user-facing token that can be used for both the HTTP API and the MCP entry point):

| Feature             | REST                              |
| ------------------- | --------------------------------- |
| Token list          | `GET /tokens`                     |
| Create Token        | `POST /tokens`                    |
| Edit Token          | `PATCH /tokens/:tokenId`          |
| View Token plaintext| `GET /tokens/:tokenId/plaintext`  |
| Delete Token        | `DELETE /tokens/:tokenId`         |

The MCP tools must be semantically consistent with REST:

- `token_list`
- `token_create`
- `token_update`
- `token_reveal`
- `token_delete`

## 6. Relationship with connectors

Webhook input connectors use a per-connector webhook token to authenticate requests (it shares the physical table with the user token from this settings page but has a fully independent scope), and it is self-managed for creation / rotation / deletion by the connector resource, not operated from the settings page.

## 7. Database and access boundary

The settings page adds no database tables and reuses `ph_core.tokens`:

- `scope='user'`: Local admin app credential; in OSS, `project_id` is always NULL; the same token can be used for both the HTTP API and the MCP entry point.
- User tokens are unlimited in number (there is no longer the "at most one valid Global MCP token at a time" constraint).

The Web UI calls the Token REST interfaces as the Local admin app identity.

## 8. Frontend interaction requirements

- User-facing strings go through `packages/web-ui/src/i18n` (`@proofhound/web-ui`), kept in sync across `zh-CN` / `en-US`.
- Token names, action buttons, and error messages must distinguish between "API token" and "Global MCP token".
- The plaintext Token is displayed in a monospace font and supports one-click copy.
- The plaintext must not be written into the URL, localStorage, sessionStorage, or a persisted React Query cache.
- On failure of creation / view plaintext / deletion, display the backend error summary; the plaintext Token must not be written into error logs.
- The delete button uses the dangerous-action style and requires a confirmation step.

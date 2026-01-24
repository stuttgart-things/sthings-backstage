# Configuration Reference

This document lists all environment variables that can be configured for the sthings-backstage instance.

## Environment Setup

Copy the example file to create your local configuration:

```bash
cp .env.example .env
```

Edit `.env` with your values. Never commit the `.env` file to version control.

## Environment Variables

### App Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `APP_TITLE` | Title shown in the Backstage UI | `My Backstage App` | No |
| `APP_BASE_URL` | Frontend URL | `http://localhost:3000` | Yes |
| `ORGANIZATION_NAME` | Organization name displayed in the UI | `My Company` | Yes |

### Backend Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `BACKEND_BASE_URL` | Backend API URL | `http://localhost:7007` | Yes |
| `BACKEND_PORT` | Port the backend listens on | `7007` | No |
| `CORS_ORIGIN` | Allowed CORS origin (usually same as APP_BASE_URL) | `http://localhost:3000` | Yes |
| `BACKEND_SECRET` | Secret key for service-to-service auth | - | Yes |

### Authentication

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `AUTH_ENVIRONMENT` | Auth environment (`development` or `production`) | `development` | No |

### GitHub Integration

| Variable | Description | Required |
|----------|-------------|----------|
| `GITHUB_TOKEN` | Personal Access Token for GitHub API | Yes |
| `GITHUB_CLIENT_ID` | OAuth App Client ID | Yes |
| `GITHUB_CLIENT_SECRET` | OAuth App Client Secret | Yes |

### GitHub Enterprise (Optional)

| Variable | Description | Required |
|----------|-------------|----------|
| `GHE_TOKEN` | Personal Access Token for GitHub Enterprise | No |
| `GHE_URL` | GitHub Enterprise instance URL | No |

### Database (Production)

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `POSTGRES_HOST` | PostgreSQL host | - | Production only |
| `POSTGRES_PORT` | PostgreSQL port | `5432` | Production only |
| `POSTGRES_USER` | PostgreSQL username | - | Production only |
| `POSTGRES_PASSWORD` | PostgreSQL password | - | Production only |

## Generating Secrets

### BACKEND_SECRET

Generate a secure random string:

```bash
node -p 'require("crypto").randomBytes(24).toString("base64")'
```

Or using openssl:

```bash
openssl rand -base64 24 # pragma: allowlist secret
```

### GITHUB_TOKEN

1. Go to [GitHub Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens)
2. Click **Generate new token (classic)**
3. Select required scopes:
   - `repo` - Full control of private repositories
   - `workflow` - Update GitHub Action workflows
   - `read:org` - Read org and team membership
   - `read:user` - Read user profile data
   - `user:email` - Access user email addresses
4. Copy the generated token

### GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET

1. Go to [GitHub Settings → Developer settings → OAuth Apps](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Configure:
   - **Homepage URL**: Your `APP_BASE_URL`
   - **Authorization callback URL**: `<BACKEND_BASE_URL>/api/auth/github/handler/frame`
4. After creation, copy the **Client ID**
5. Click **Generate a new client secret** and copy it

## Example .env File

```bash
# App Configuration
APP_TITLE=My Backstage
APP_BASE_URL=http://localhost:3000

# Organization
ORGANIZATION_NAME=my-org

# Backend Configuration
BACKEND_BASE_URL=http://localhost:7007
BACKEND_PORT=7007
CORS_ORIGIN=http://localhost:3000

# Auth
AUTH_ENVIRONMENT=development

# GitHub Integration
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx # pragma: allowlist secret

# GitHub OAuth App
GITHUB_CLIENT_ID=Iv1.xxxxxxxxxx # pragma: allowlist secret
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx # pragma: allowlist secret

# Backend Secret
BACKEND_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx # pragma: allowlist secret
```

## Production Considerations

### URLs

Update all URL variables to use your production domain:

```bash
APP_BASE_URL=https://backstage.example.com
BACKEND_BASE_URL=https://backstage.example.com
CORS_ORIGIN=https://backstage.example.com
```

### Database

Switch from SQLite to PostgreSQL for production:

```bash
POSTGRES_HOST=postgres.example.com
POSTGRES_PORT=5432
POSTGRES_USER=backstage
POSTGRES_PASSWORD=<secure-password>
```

### Secrets Management

For production deployments, consider using:

- Kubernetes Secrets
- HashiCorp Vault
- AWS Secrets Manager
- Azure Key Vault
- Google Secret Manager

### GitHub OAuth App

Update the OAuth App callback URL to match your production backend URL:

```
https://backstage.example.com/api/auth/github/handler/frame
```

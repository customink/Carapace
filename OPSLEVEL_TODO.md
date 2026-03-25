# OpsLevel Manual Steps for Carapace

Complete these to reach Bronze:

## Default Branch is Protected
- Go to https://github.com/customink/Carapace/settings/branches
- Click "Add branch protection rule"
- Branch name pattern: `main`
- Enable: "Require a pull request before merging"
- Enable: "Require status checks to pass before merging"
- Save changes

## Service Name — kebab-case
- The OpsLevel alias is already `carapace` (kebab-case) ✓
- If the check still fails, go to https://app.opslevel.com/components/carapace
- Click the pencil icon next to "Carapace" and rename to "carapace" (lowercase)

## Verify progress
```bash
opslevel get service maturity carapace
```

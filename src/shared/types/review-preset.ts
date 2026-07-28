/** Placeholder variables available to a review prompt template. */
export interface ReviewVars {
  pr_url: string
  owner: string
  repo: string
  pr_number: string
  branch: string
  slack_permalink: string
  slack_message: string
}

export interface ReviewPreset {
  id: string
  name: string      // display name in the dropdown
  template: string  // prompt body with {{placeholders}}
  worktree: boolean // check the PR out into a dedicated git worktree
  isQuick?: boolean // the one used by "Quick Review", which skips the dialog
  bypass?: boolean  // pass --dangerously-skip-permissions when quick review runs this
}

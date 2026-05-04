export interface StackProject {
  name: string
  path: string
}

export interface Stack {
  id: string
  name: string
  description: string
  systemPath: string    // cwd for the stack (field `system` in import format)
  projects: StackProject[]
}

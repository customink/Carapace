export interface Preset {
  id: string
  name: string           // display name in menu
  title: string          // session title
  folder: string         // working directory
  bypass: boolean        // skip permissions
  color: string          // hex color or '' for auto
  shellTab: boolean      // open companion shell tab(s)
  shellTabCount: number  // number of companion shell tabs (1+)
  shellTabNames: string[] // custom names per shell tab
  stackId?: string       // optional: linked stack; stack.systemPath overrides folder at launch
}

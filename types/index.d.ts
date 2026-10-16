export type Limits = { fiveHour: number | null; week: number | null } // percent used, null before the first reading

declare module 'claude-code' {
  interface PluginState {
    sidedeck: { expanded: string[]; viewing: string | null; editing: boolean; treeTop: number; limits: Limits; query: string }
  }
}

/**
 * Which services the signed-in user may see.
 *
 * Lives in `shared/` rather than on `Sidebar` (where it used to be exported
 * from) so that `shared/ui` never has to import from `features/`.
 */
export interface ServiceEntitlements {
  translation: boolean;
  sales: boolean;
}

/** The other modules' contracts this module uses, gathered in one place. */
export { CatalogueService, ProductMediaService } from '../../catalogue';
export type { AttributeDefinition, BrandView, CategoryView, ProductState } from '../../catalogue';
export { ListingService } from '../../listings';
export type { ListingState } from '../../listings';
export { InventoryService } from '../../inventory';
export type { StockView, WarehouseView } from '../../inventory';
export { SettingsReader } from '../../settings';

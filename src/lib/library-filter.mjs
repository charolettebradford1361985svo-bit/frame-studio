import { WORKBENCHES } from './workbenches.mjs';

export function libraryAssetKind(kind) {
  return WORKBENCHES.some(entry => entry.kind === kind) ? kind : 'other';
}

export function filterLibraryAssets(assets, search = '', kind = 'all') {
  const query = search.trim().toLocaleLowerCase();
  return assets.filter(asset => (kind === 'all' || libraryAssetKind(asset.kind) === kind)
    && asset.name.toLocaleLowerCase().includes(query));
}

import type { BuildingCandidate, ListBuildingsResult } from './types';
import IndexedListPicker, { textColumn } from '../../components/IndexedListPicker';

const COLUMNS = [
  textColumn<BuildingCandidate>('Name', 'name', { wrap: true, width: '1.4fr' }),
  textColumn<BuildingCandidate>('City', 'city', { width: '1fr' }),
  textColumn<BuildingCandidate>('Country', 'country', { width: '1fr' }),
  textColumn<BuildingCandidate>('Post Code', 'post_code', { width: '1fr' }),
];

// Rendered by ChatPanel (via registry/chatExtras.tsx) for
// list_buildings_by_address — Location Classification's building lookup.
// Same clickable-picker treatment as PortSearch.tsx, built on the shared
// IndexedListPicker instead of its own table markup.
export default function BuildingSearch({
  result,
  onSelect,
}: {
  result: ListBuildingsResult;
  onSelect: (text: string) => void;
}) {
  if (result.error) {
    return (
      <div className="picker-table-wrap picker-table-wrap--error">
        Building lookup is temporarily unavailable: {result.error}
      </div>
    );
  }

  const buildings = Array.isArray(result.buildings) ? result.buildings : [];

  return (
    <IndexedListPicker
      rows={buildings}
      columns={COLUMNS}
      onSelect={onSelect}
      selectMessage={(building) => `I'll use building #${building.index}: ${building.name}.`}
      emptyMessage="No buildings found."
    />
  );
}

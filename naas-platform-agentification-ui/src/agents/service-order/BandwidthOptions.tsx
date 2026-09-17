import type { BandwidthCandidate, ListBandwidthsResult } from './types';
import IndexedListPicker from '../../components/IndexedListPicker';

const COLUMNS = [
  {
    label: 'Bandwidth',
    render: (row: BandwidthCandidate) => `${row.bandwidth_mbps} Mbps`,
    width: '1fr',
  },
];

// Rendered by ChatPanel (via registry/chatExtras.tsx) for
// list_offnet_bandwidths/list_comcast_bandwidths — Colt-Offnet/
// Comcast-Offnet's bandwidth-selection step (Location Classification).
// Same clickable-picker treatment as every other list-tool, built on the
// shared IndexedListPicker.
export default function BandwidthOptions({
  result,
  onSelect,
}: {
  result: ListBandwidthsResult;
  onSelect: (text: string) => void;
}) {
  const bandwidths = Array.isArray(result.bandwidths) ? result.bandwidths : [];

  return (
    <IndexedListPicker
      rows={bandwidths}
      columns={COLUMNS}
      onSelect={onSelect}
      selectMessage={(row) => `I'll go with #${row.index}: ${row.bandwidth_mbps} Mbps.`}
      emptyMessage="No bandwidth options available."
    />
  );
}

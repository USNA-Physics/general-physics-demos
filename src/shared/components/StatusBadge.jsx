const statusStyles = {
  unresolved: 'bg-red-700/30 text-red-400 border-red-600',
  rayleigh: 'bg-usna-gold/20 text-usna-gold border-usna-gold',
  resolved: 'bg-green-700/30 text-green-400 border-green-600',
};

export default function StatusBadge({ status, label }) {
  const style = statusStyles[status] || statusStyles.unresolved;
  return (
    <span
      className={`inline-block px-3 py-1 rounded-full text-sm font-semibold border text-center ${style}`}
      style={{ minWidth: '14rem' }}
    >
      {label}
    </span>
  );
}

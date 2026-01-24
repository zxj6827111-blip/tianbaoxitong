exports.up = (pgm) => {
  pgm.addColumns('report_version', {
    draft_snapshot_hash: { type: 'text' },
    pdf_path: { type: 'text' },
    pdf_sha256: { type: 'text' },
    excel_path: { type: 'text' },
    excel_sha256: { type: 'text' },
    created_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' }
  });

  pgm.createIndex('report_version', ['draft_id', 'draft_snapshot_hash']);
};

exports.down = (pgm) => {
  pgm.dropIndex('report_version', ['draft_id', 'draft_snapshot_hash']);

  pgm.dropColumns('report_version', [
    'draft_snapshot_hash',
    'pdf_path',
    'pdf_sha256',
    'excel_path',
    'excel_sha256',
    'created_by'
  ]);
};

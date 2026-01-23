exports.up = (pgm) => {
  pgm.addColumn('history_import_batch', {
    errors_json: { type: 'jsonb' },
    locked_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' }
  });

  pgm.createIndex('history_actuals', ['unit_id', 'year', 'key']);
};

exports.down = (pgm) => {
  pgm.dropIndex('history_actuals', ['unit_id', 'year', 'key']);
  pgm.dropColumn('history_import_batch', ['errors_json', 'locked_by']);
};

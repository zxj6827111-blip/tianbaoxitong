exports.up = (pgm) => {
  pgm.addColumn('history_actuals', {
    source_preview_batch_id: {
      type: 'uuid',
      references: 'archive_preview_batch',
      onDelete: 'SET NULL'
    }
  });

  pgm.createIndex('history_actuals', ['source_preview_batch_id']);
};

exports.down = (pgm) => {
  pgm.dropIndex('history_actuals', ['source_preview_batch_id'], { ifExists: true });
  pgm.dropColumn('history_actuals', 'source_preview_batch_id', { ifExists: true });
};

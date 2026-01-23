exports.up = (pgm) => {
  pgm.addColumn('report_draft', {
    upload_id: {
      type: 'uuid',
      references: 'upload_job',
      onDelete: 'SET NULL'
    }
  });

  pgm.createIndex('report_draft', ['upload_id'], { unique: true });
};

exports.down = (pgm) => {
  pgm.dropIndex('report_draft', ['upload_id']);
  pgm.dropColumn('report_draft', 'upload_id');
};

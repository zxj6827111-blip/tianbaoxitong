exports.up = (pgm) => {
  pgm.addColumn('correction_suggestion', {
    draft_id: { type: 'uuid', references: 'report_draft', onDelete: 'SET NULL' },
    department_id: { type: 'uuid', references: 'org_department', onDelete: 'SET NULL' },
    old_value_wanyuan: { type: 'numeric(18,2)' },
    suggest_value_wanyuan: { type: 'numeric(18,2)' }
  });

  pgm.createIndex('correction_suggestion', ['status', 'year', 'department_id']);
  pgm.createIndex('correction_suggestion', ['draft_id']);
  pgm.createIndex('correction_suggestion', ['unit_id', 'year', 'key']);

  pgm.addColumn('history_actuals', {
    provenance_source: { type: 'text' },
    source_suggestion_id: { type: 'uuid', references: 'correction_suggestion', onDelete: 'SET NULL' }
  });

  pgm.addColumn('report_version', {
    provenance_source: { type: 'text' },
    suggestion_status: { type: 'text' }
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('report_version', ['provenance_source', 'suggestion_status']);

  pgm.dropColumn('history_actuals', ['provenance_source', 'source_suggestion_id']);

  pgm.dropIndex('correction_suggestion', ['unit_id', 'year', 'key']);
  pgm.dropIndex('correction_suggestion', ['draft_id']);
  pgm.dropIndex('correction_suggestion', ['status', 'year', 'department_id']);
  pgm.dropColumn('correction_suggestion', ['draft_id', 'department_id', 'old_value_wanyuan', 'suggest_value_wanyuan']);
};

exports.up = (pgm) => {
  pgm.createTable('archive_preview_batch', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    report_id: {
      type: 'uuid',
      notNull: true,
      references: 'org_dept_annual_report',
      onDelete: 'CASCADE'
    },
    department_id: {
      type: 'uuid',
      notNull: true,
      references: 'org_department',
      onDelete: 'CASCADE'
    },
    unit_id: {
      type: 'uuid',
      notNull: true,
      references: 'org_unit',
      onDelete: 'CASCADE'
    },
    year: { type: 'integer', notNull: true },
    report_type: { type: 'text', notNull: true, default: 'BUDGET' },
    file_name: { type: 'text', notNull: true },
    raw_text: { type: 'text' },
    status: { type: 'text', notNull: true, default: 'PENDING_REVIEW' },
    created_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    reviewed_at: { type: 'timestamptz' },
    committed_at: { type: 'timestamptz' },
    committed_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });
  pgm.addConstraint('archive_preview_batch', 'archive_preview_batch_status_check', {
    check: "status IN ('PENDING_REVIEW', 'REVIEWED', 'COMMITTED', 'REJECTED')"
  });
  pgm.createIndex('archive_preview_batch', ['unit_id', 'year', 'status']);
  pgm.createIndex('archive_preview_batch', ['report_id']);

  pgm.createTable('archive_preview_field', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    batch_id: {
      type: 'uuid',
      notNull: true,
      references: 'archive_preview_batch',
      onDelete: 'CASCADE'
    },
    key: { type: 'text', notNull: true },
    raw_value: { type: 'text' },
    normalized_value: { type: 'numeric(18,2)' },
    confidence: { type: 'text', notNull: true, default: 'LOW' },
    match_source: { type: 'text' },
    raw_text_snippet: { type: 'text' },
    confirmed: { type: 'boolean', notNull: true, default: false },
    confirmed_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    confirmed_at: { type: 'timestamptz' },
    corrected_value: { type: 'numeric(18,2)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  }, {
    constraints: {
      unique: ['batch_id', 'key']
    }
  });
  pgm.addConstraint('archive_preview_field', 'archive_preview_field_confidence_check', {
    check: "confidence IN ('HIGH', 'MEDIUM', 'LOW', 'UNRECOGNIZED')"
  });
  pgm.createIndex('archive_preview_field', ['batch_id', 'confidence']);

  pgm.createTable('archive_preview_issue', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    batch_id: {
      type: 'uuid',
      notNull: true,
      references: 'archive_preview_batch',
      onDelete: 'CASCADE'
    },
    rule_id: { type: 'text', notNull: true },
    level: { type: 'text', notNull: true },
    message: { type: 'text', notNull: true },
    evidence: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });
  pgm.addConstraint('archive_preview_issue', 'archive_preview_issue_level_check', {
    check: "level IN ('ERROR', 'WARN')"
  });
  pgm.createIndex('archive_preview_issue', ['batch_id', 'level']);

  pgm.createTable('archive_correction_feedback', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    batch_id: {
      type: 'uuid',
      references: 'archive_preview_batch',
      onDelete: 'SET NULL'
    },
    field_key: { type: 'text', notNull: true },
    raw_text: { type: 'text', notNull: true },
    predicted_value: { type: 'numeric(18,2)' },
    corrected_value: { type: 'numeric(18,2)' },
    operator_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });
  pgm.createIndex('archive_correction_feedback', ['field_key']);
  pgm.createIndex('archive_correction_feedback', ['batch_id']);

  pgm.createTable('custom_alias_mapping', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    raw_label: { type: 'text', notNull: true },
    normalized_label: { type: 'text', notNull: true },
    resolved_key: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'CANDIDATE' },
    source_batch_id: {
      type: 'uuid',
      references: 'archive_preview_batch',
      onDelete: 'SET NULL'
    },
    approved_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    approved_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  }, {
    constraints: {
      unique: ['normalized_label', 'resolved_key']
    }
  });
  pgm.addConstraint('custom_alias_mapping', 'custom_alias_mapping_status_check', {
    check: "status IN ('CANDIDATE', 'APPROVED', 'REJECTED')"
  });
  pgm.createIndex('custom_alias_mapping', ['status']);
  pgm.createIndex('custom_alias_mapping', ['normalized_label']);
};

exports.down = (pgm) => {
  pgm.dropIndex('custom_alias_mapping', ['normalized_label'], { ifExists: true });
  pgm.dropIndex('custom_alias_mapping', ['status'], { ifExists: true });
  pgm.dropConstraint('custom_alias_mapping', 'custom_alias_mapping_status_check', { ifExists: true });
  pgm.dropTable('custom_alias_mapping', { ifExists: true });

  pgm.dropIndex('archive_correction_feedback', ['batch_id'], { ifExists: true });
  pgm.dropIndex('archive_correction_feedback', ['field_key'], { ifExists: true });
  pgm.dropTable('archive_correction_feedback', { ifExists: true });

  pgm.dropIndex('archive_preview_issue', ['batch_id', 'level'], { ifExists: true });
  pgm.dropConstraint('archive_preview_issue', 'archive_preview_issue_level_check', { ifExists: true });
  pgm.dropTable('archive_preview_issue', { ifExists: true });

  pgm.dropIndex('archive_preview_field', ['batch_id', 'confidence'], { ifExists: true });
  pgm.dropConstraint('archive_preview_field', 'archive_preview_field_confidence_check', { ifExists: true });
  pgm.dropTable('archive_preview_field', { ifExists: true });

  pgm.dropIndex('archive_preview_batch', ['report_id'], { ifExists: true });
  pgm.dropIndex('archive_preview_batch', ['unit_id', 'year', 'status'], { ifExists: true });
  pgm.dropConstraint('archive_preview_batch', 'archive_preview_batch_status_check', { ifExists: true });
  pgm.dropTable('archive_preview_batch', { ifExists: true });
};


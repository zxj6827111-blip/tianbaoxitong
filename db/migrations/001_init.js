exports.up = (pgm) => {
  pgm.createExtension('pgcrypto', { ifNotExists: true });

  pgm.createTable('org_department', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    code: { type: 'text', notNull: true, unique: true },
    name: { type: 'text', notNull: true },
    parent_id: { type: 'uuid', references: 'org_department', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });

  pgm.createTable('org_unit', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    department_id: {
      type: 'uuid',
      notNull: true,
      references: 'org_department',
      onDelete: 'RESTRICT'
    },
    code: { type: 'text', notNull: true, unique: true },
    name: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });

  pgm.createTable('users', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    email: { type: 'text', notNull: true, unique: true },
    password_hash: { type: 'text', notNull: true },
    display_name: { type: 'text' },
    unit_id: { type: 'uuid', references: 'org_unit', onDelete: 'SET NULL' },
    department_id: { type: 'uuid', references: 'org_department', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });

  pgm.createTable('roles', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    name: { type: 'text', notNull: true, unique: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });

  pgm.createTable('user_roles', {
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    role_id: { type: 'uuid', notNull: true, references: 'roles', onDelete: 'CASCADE' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  }, {
    constraints: {
      primaryKey: ['user_id', 'role_id']
    }
  });

  pgm.createTable('base_info_version', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    scope_type: { type: 'text', notNull: true },
    scope_id: { type: 'uuid', notNull: true },
    year: { type: 'integer', notNull: true },
    version_no: { type: 'integer', notNull: true },
    content_json: { type: 'jsonb', notNull: true },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  }, {
    constraints: {
      unique: ['scope_type', 'scope_id', 'year', 'version_no']
    }
  });

  pgm.createIndex('base_info_version', ['scope_type', 'scope_id', 'year', 'is_active', 'version_no']);

  pgm.createTable('history_import_batch', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    source_file_name: { type: 'text' },
    source_file_hash: { type: 'text' },
    status: { type: 'text', notNull: true, default: 'PENDING' },
    locked_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });

  pgm.createTable('history_actuals', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    unit_id: { type: 'uuid', notNull: true, references: 'org_unit', onDelete: 'RESTRICT' },
    year: { type: 'integer', notNull: true },
    stage: { type: 'text', notNull: true },
    key: { type: 'text', notNull: true },
    value_numeric: { type: 'numeric(18,2)', notNull: true },
    source_batch_id: { type: 'uuid', references: 'history_import_batch', onDelete: 'SET NULL' },
    is_locked: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  }, {
    constraints: {
      unique: ['unit_id', 'year', 'stage', 'key']
    }
  });

  pgm.createTable('upload_job', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    unit_id: { type: 'uuid', notNull: true, references: 'org_unit', onDelete: 'RESTRICT' },
    year: { type: 'integer', notNull: true },
    caliber: { type: 'text', notNull: true },
    file_name: { type: 'text', notNull: true },
    file_hash: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'PENDING' },
    uploaded_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  }, {
    constraints: {
      unique: ['unit_id', 'year', 'file_hash']
    }
  });

  pgm.createTable('parsed_cells', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    upload_id: { type: 'uuid', notNull: true, references: 'upload_job', onDelete: 'CASCADE' },
    sheet_name: { type: 'text', notNull: true },
    cell_address: { type: 'text', notNull: true },
    anchor: { type: 'text' },
    raw_value: { type: 'text' },
    normalized_value: { type: 'text' },
    value_type: { type: 'text' },
    number_format: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  }, {
    constraints: {
      unique: ['upload_id', 'sheet_name', 'cell_address']
    }
  });

  pgm.createIndex('parsed_cells', ['upload_id']);

  pgm.createTable('facts_budget', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    upload_id: { type: 'uuid', notNull: true, references: 'upload_job', onDelete: 'CASCADE' },
    unit_id: { type: 'uuid', notNull: true, references: 'org_unit', onDelete: 'RESTRICT' },
    year: { type: 'integer', notNull: true },
    key: { type: 'text', notNull: true },
    value_numeric: { type: 'numeric(18,2)', notNull: true },
    evidence: { type: 'jsonb' },
    provenance: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  }, {
    constraints: {
      unique: ['upload_id', 'key']
    }
  });

  pgm.createIndex('facts_budget', ['unit_id', 'year']);

  pgm.createTable('report_draft', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    unit_id: { type: 'uuid', notNull: true, references: 'org_unit', onDelete: 'RESTRICT' },
    year: { type: 'integer', notNull: true },
    template_version: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'DRAFT' },
    created_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });

  pgm.createTable('validation_issues', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    draft_id: { type: 'uuid', notNull: true, references: 'report_draft', onDelete: 'CASCADE' },
    level: { type: 'text', notNull: true },
    rule_id: { type: 'text', notNull: true },
    message: { type: 'text', notNull: true },
    tolerance: { type: 'numeric(18,2)', notNull: true, default: 0.01 },
    evidence: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });

  pgm.createIndex('validation_issues', ['draft_id', 'level']);

  pgm.createTable('manual_inputs', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    draft_id: { type: 'uuid', notNull: true, references: 'report_draft', onDelete: 'CASCADE' },
    key: { type: 'text', notNull: true },
    value_json: { type: 'jsonb' },
    value_text: { type: 'text' },
    value_numeric: { type: 'numeric(18,2)' },
    evidence: { type: 'jsonb' },
    notes: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  }, {
    constraints: {
      unique: ['draft_id', 'key']
    }
  });

  pgm.createTable('line_items_reason', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    draft_id: { type: 'uuid', notNull: true, references: 'report_draft', onDelete: 'CASCADE' },
    item_key: { type: 'text', notNull: true },
    sort_order: { type: 'integer', notNull: true, default: 0 },
    reason_text: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  }, {
    constraints: {
      unique: ['draft_id', 'item_key']
    }
  });

  pgm.createTable('report_version', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    draft_id: { type: 'uuid', notNull: true, references: 'report_draft', onDelete: 'CASCADE' },
    version_no: { type: 'integer', notNull: true },
    generated_at: { type: 'timestamptz' },
    template_version: { type: 'text', notNull: true },
    draft_hash: { type: 'text' },
    provenance_summary: { type: 'jsonb' },
    pdf_file_key: { type: 'text' },
    excel_file_key: { type: 'text' },
    is_frozen: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  }, {
    constraints: {
      unique: ['draft_id', 'version_no']
    }
  });

  pgm.createTable('correction_suggestion', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    unit_id: { type: 'uuid', notNull: true, references: 'org_unit', onDelete: 'RESTRICT' },
    year: { type: 'integer', notNull: true },
    key: { type: 'text', notNull: true },
    old_value: { type: 'numeric(18,2)' },
    suggest_value: { type: 'numeric(18,2)' },
    reason: { type: 'text' },
    status: { type: 'text', notNull: true, default: 'PENDING' },
    created_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    reviewed_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    reviewed_at: { type: 'timestamptz' },
    attachments_json: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });

  pgm.createIndex('correction_suggestion', ['status', 'year']);

  pgm.createTable('audit_log', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    actor_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    action: { type: 'text', notNull: true },
    entity_type: { type: 'text', notNull: true },
    entity_id: { type: 'uuid' },
    meta_json: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    ip: { type: 'text' },
    user_agent: { type: 'text' }
  });

  pgm.createIndex('audit_log', ['entity_type', 'entity_id']);
  pgm.createIndex('audit_log', ['created_at']);

  pgm.sql(`
    INSERT INTO roles (id, name)
    VALUES
      (gen_random_uuid(), 'admin'),
      (gen_random_uuid(), 'maintainer'),
      (gen_random_uuid(), 'reporter'),
      (gen_random_uuid(), 'viewer')
    ON CONFLICT (name) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('audit_log');
  pgm.dropTable('correction_suggestion');
  pgm.dropTable('report_version');
  pgm.dropTable('line_items_reason');
  pgm.dropTable('manual_inputs');
  pgm.dropIndex('validation_issues', ['draft_id', 'level']);
  pgm.dropTable('validation_issues');
  pgm.dropTable('report_draft');
  pgm.dropIndex('facts_budget', ['unit_id', 'year']);
  pgm.dropTable('facts_budget');
  pgm.dropIndex('parsed_cells', ['upload_id']);
  pgm.dropTable('parsed_cells');
  pgm.dropTable('upload_job');
  pgm.dropTable('history_actuals');
  pgm.dropTable('history_import_batch');
  pgm.dropIndex('base_info_version', ['scope_type', 'scope_id', 'year', 'is_active', 'version_no']);
  pgm.dropTable('base_info_version');
  pgm.dropTable('user_roles');
  pgm.dropTable('roles');
  pgm.dropTable('users');
  pgm.dropTable('org_unit');
  pgm.dropTable('org_department');
};

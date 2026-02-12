exports.up = (pgm) => {
  pgm.createTable('org_dept_table_data', {
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
    year: { type: 'integer', notNull: true },
    report_type: { type: 'text', notNull: true },
    table_key: { type: 'text', notNull: true },
    table_title: { type: 'text' },
    page_numbers: { type: 'integer[]' },
    row_count: { type: 'integer', notNull: true, default: 0 },
    col_count: { type: 'integer', notNull: true, default: 0 },
    data_json: { type: 'jsonb', notNull: true },
    created_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  }, {
    constraints: {
      unique: ['report_id', 'table_key']
    }
  });

  pgm.createIndex('org_dept_table_data', ['department_id', 'year']);
  pgm.createIndex('org_dept_table_data', ['report_id']);
};

exports.down = (pgm) => {
  pgm.dropIndex('org_dept_table_data', ['report_id']);
  pgm.dropIndex('org_dept_table_data', ['department_id', 'year']);
  pgm.dropTable('org_dept_table_data');
};

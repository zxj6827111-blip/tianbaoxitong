exports.up = (pgm) => {
  pgm.createTable('org_dept_line_items', {
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
    row_index: { type: 'integer', notNull: true },
    class_code: { type: 'text' },
    type_code: { type: 'text' },
    item_code: { type: 'text' },
    item_name: { type: 'text' },
    values_json: { type: 'jsonb', notNull: true },
    created_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  }, {
    constraints: {
      unique: ['report_id', 'table_key', 'row_index']
    }
  });

  pgm.createIndex('org_dept_line_items', ['department_id', 'year']);
  pgm.createIndex('org_dept_line_items', ['report_id']);
  pgm.createIndex('org_dept_line_items', ['table_key']);
};

exports.down = (pgm) => {
  pgm.dropIndex('org_dept_line_items', ['table_key']);
  pgm.dropIndex('org_dept_line_items', ['report_id']);
  pgm.dropIndex('org_dept_line_items', ['department_id', 'year']);
  pgm.dropTable('org_dept_line_items');
};

exports.up = (pgm) => {
  // Add sort_order to org_department
  pgm.addColumn('org_department', {
    sort_order: { type: 'integer', notNull: true, default: 0 }
  });

  // Add sort_order to org_unit
  pgm.addColumn('org_unit', {
    sort_order: { type: 'integer', notNull: true, default: 0 }
  });

  // Create index for sorting
  pgm.createIndex('org_department', ['parent_id', 'sort_order']);
  pgm.createIndex('org_unit', ['department_id', 'sort_order']);

  // Create table for annual report PDFs
  pgm.createTable('org_dept_annual_report', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    department_id: {
      type: 'uuid',
      notNull: true,
      references: 'org_department',
      onDelete: 'CASCADE'
    },
    year: { type: 'integer', notNull: true },
    report_type: { type: 'text', notNull: true }, // 'BUDGET' or 'FINAL'
    file_name: { type: 'text', notNull: true },
    file_path: { type: 'text', notNull: true },
    file_hash: { type: 'text', notNull: true },
    file_size: { type: 'bigint', notNull: true },
    uploaded_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  }, {
    constraints: {
      unique: ['department_id', 'year', 'report_type']
    }
  });

  pgm.createIndex('org_dept_annual_report', ['department_id', 'year']);

  // Create table for extracted/reusable text content
  pgm.createTable('org_dept_text_content', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    department_id: {
      type: 'uuid',
      notNull: true,
      references: 'org_department',
      onDelete: 'CASCADE'
    },
    year: { type: 'integer', notNull: true },
    category: { type: 'text', notNull: true }, // 'FUNCTION', 'STRUCTURE', 'TERMINOLOGY', 'OTHER'
    content_text: { type: 'text', notNull: true },
    source_report_id: { type: 'uuid', references: 'org_dept_annual_report', onDelete: 'SET NULL' },
    created_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  }, {
    constraints: {
      unique: ['department_id', 'year', 'category']
    }
  });

  pgm.createIndex('org_dept_text_content', ['department_id', 'year', 'category']);
};

exports.down = (pgm) => {
  pgm.dropTable('org_dept_text_content');
  pgm.dropTable('org_dept_annual_report');
  
  pgm.dropIndex('org_unit', ['department_id', 'sort_order']);
  pgm.dropIndex('org_department', ['parent_id', 'sort_order']);
  
  pgm.dropColumn('org_unit', 'sort_order');
  pgm.dropColumn('org_department', 'sort_order');
};

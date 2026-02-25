exports.up = (pgm) => {
  // Archive reports: scope by unit to avoid overwriting across units in one department.
  pgm.addColumn('org_dept_annual_report', {
    unit_id: { type: 'uuid', references: 'org_unit', onDelete: 'SET NULL' }
  });

  pgm.sql(`
    UPDATE org_dept_annual_report ar
    SET unit_id = (
      SELECT u.id
      FROM org_unit u
      WHERE u.department_id = ar.department_id
      ORDER BY u.sort_order ASC, u.created_at ASC, u.id ASC
      LIMIT 1
    )
    WHERE ar.unit_id IS NULL
  `);

  pgm.dropConstraint('org_dept_annual_report', 'org_dept_annual_report_department_id_year_report_type_key', { ifExists: true });
  pgm.addConstraint('org_dept_annual_report', 'org_dept_annual_report_department_id_unit_id_year_report_type_key', {
    unique: ['department_id', 'unit_id', 'year', 'report_type']
  });
  pgm.createIndex('org_dept_annual_report', ['department_id', 'unit_id', 'year'], {
    name: 'org_dept_annual_report_department_id_unit_id_year_idx'
  });

  // Text content: scope by unit as well, aligned with report scoping.
  pgm.addColumn('org_dept_text_content', {
    unit_id: { type: 'uuid', references: 'org_unit', onDelete: 'SET NULL' }
  });

  pgm.sql(`
    UPDATE org_dept_text_content tc
    SET unit_id = ar.unit_id
    FROM org_dept_annual_report ar
    WHERE tc.source_report_id = ar.id
      AND tc.unit_id IS NULL
  `);

  pgm.sql(`
    UPDATE org_dept_text_content tc
    SET unit_id = ar.unit_id
    FROM org_dept_annual_report ar
    WHERE tc.unit_id IS NULL
      AND tc.department_id = ar.department_id
      AND tc.year = ar.year
      AND tc.report_type = ar.report_type
  `);

  pgm.dropConstraint('org_dept_text_content', 'org_dept_text_content_department_id_year_report_type_category_key', { ifExists: true });
  pgm.addConstraint('org_dept_text_content', 'org_dept_text_content_department_id_unit_id_year_report_type_category_key', {
    unique: ['department_id', 'unit_id', 'year', 'report_type', 'category']
  });

  pgm.dropIndex('org_dept_text_content', ['department_id', 'year', 'report_type', 'category'], { ifExists: true });
  pgm.createIndex('org_dept_text_content', ['department_id', 'unit_id', 'year', 'report_type', 'category'], {
    name: 'org_dept_text_content_unit_scope_idx'
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('org_dept_text_content', ['department_id', 'unit_id', 'year', 'report_type', 'category'], {
    ifExists: true,
    name: 'org_dept_text_content_unit_scope_idx'
  });
  pgm.createIndex('org_dept_text_content', ['department_id', 'year', 'report_type', 'category']);

  pgm.dropConstraint('org_dept_text_content', 'org_dept_text_content_department_id_unit_id_year_report_type_category_key', { ifExists: true });
  pgm.addConstraint('org_dept_text_content', 'org_dept_text_content_department_id_year_report_type_category_key', {
    unique: ['department_id', 'year', 'report_type', 'category']
  });
  pgm.dropColumn('org_dept_text_content', 'unit_id');

  pgm.dropIndex('org_dept_annual_report', ['department_id', 'unit_id', 'year'], {
    ifExists: true,
    name: 'org_dept_annual_report_department_id_unit_id_year_idx'
  });
  pgm.dropConstraint('org_dept_annual_report', 'org_dept_annual_report_department_id_unit_id_year_report_type_key', { ifExists: true });
  pgm.addConstraint('org_dept_annual_report', 'org_dept_annual_report_department_id_year_report_type_key', {
    unique: ['department_id', 'year', 'report_type']
  });
  pgm.dropColumn('org_dept_annual_report', 'unit_id');
};

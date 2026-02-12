exports.up = (pgm) => {
  pgm.addColumn('org_dept_text_content', {
    report_type: {
      type: 'text',
      notNull: true,
      default: 'BUDGET'
    }
  });

  pgm.addConstraint('org_dept_text_content', 'org_dept_text_content_report_type_check', {
    check: "report_type IN ('BUDGET', 'FINAL')"
  });

  pgm.sql(`
    UPDATE org_dept_text_content tc
    SET report_type = ar.report_type
    FROM org_dept_annual_report ar
    WHERE tc.source_report_id = ar.id
  `);

  pgm.dropConstraint('org_dept_text_content', 'org_dept_text_content_department_id_year_category_key', { ifExists: true });
  pgm.addConstraint('org_dept_text_content', 'org_dept_text_content_department_id_year_report_type_category_key', {
    unique: ['department_id', 'year', 'report_type', 'category']
  });

  pgm.dropIndex('org_dept_text_content', ['department_id', 'year', 'category'], { ifExists: true });
  pgm.createIndex('org_dept_text_content', ['department_id', 'year', 'report_type', 'category']);
};

exports.down = (pgm) => {
  pgm.dropIndex('org_dept_text_content', ['department_id', 'year', 'report_type', 'category'], { ifExists: true });
  pgm.createIndex('org_dept_text_content', ['department_id', 'year', 'category']);

  pgm.dropConstraint('org_dept_text_content', 'org_dept_text_content_department_id_year_report_type_category_key', { ifExists: true });
  pgm.addConstraint('org_dept_text_content', 'org_dept_text_content_department_id_year_category_key', {
    unique: ['department_id', 'year', 'category']
  });

  pgm.dropConstraint('org_dept_text_content', 'org_dept_text_content_report_type_check', { ifExists: true });
  pgm.dropColumn('org_dept_text_content', 'report_type');
};

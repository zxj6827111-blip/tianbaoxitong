exports.up = (pgm) => {
  // Legacy constraints from early archive schema (department-scoped only).
  // They conflict with the new unit-scoped uniqueness introduced later.
  pgm.dropConstraint(
    'org_dept_annual_report',
    'org_dept_annual_report_uniq_department_id_year_report_type',
    { ifExists: true }
  );

  pgm.dropConstraint(
    'org_dept_text_content',
    'org_dept_text_content_uniq_department_id_year_category',
    { ifExists: true }
  );
};

exports.down = (pgm) => {
  pgm.addConstraint(
    'org_dept_annual_report',
    'org_dept_annual_report_uniq_department_id_year_report_type',
    {
      unique: ['department_id', 'year', 'report_type']
    }
  );

  pgm.addConstraint(
    'org_dept_text_content',
    'org_dept_text_content_uniq_department_id_year_category',
    {
      unique: ['department_id', 'year', 'category']
    }
  );
};

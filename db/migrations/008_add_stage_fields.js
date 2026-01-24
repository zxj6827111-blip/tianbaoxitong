exports.up = (pgm) => {
  pgm.addColumn('upload_job', {
    stage: {
      type: 'text',
      notNull: true,
      default: 'BUDGET'
    }
  });

  pgm.addConstraint('upload_job', 'upload_job_stage_check', {
    check: "stage IN ('BUDGET', 'FINAL')"
  });

  pgm.addColumn('report_draft', {
    stage: {
      type: 'text',
      notNull: true,
      default: 'BUDGET'
    }
  });

  pgm.addConstraint('report_draft', 'report_draft_stage_check', {
    check: "stage IN ('BUDGET', 'FINAL')"
  });

  pgm.alterColumn('history_actuals', 'stage', {
    default: 'FINAL'
  });

  pgm.addConstraint('history_actuals', 'history_actuals_stage_check', {
    check: "stage IN ('BUDGET', 'FINAL')"
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('history_actuals', 'history_actuals_stage_check', { ifExists: true });
  pgm.alterColumn('history_actuals', 'stage', { default: null });

  pgm.dropConstraint('report_draft', 'report_draft_stage_check', { ifExists: true });
  pgm.dropColumn('report_draft', 'stage');

  pgm.dropConstraint('upload_job', 'upload_job_stage_check', { ifExists: true });
  pgm.dropColumn('upload_job', 'stage');
};

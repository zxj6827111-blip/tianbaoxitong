exports.up = (pgm) => {
  pgm.createTable('login_rate_limit_bucket', {
    bucket_key: { type: 'text', primaryKey: true },
    scope: { type: 'text', notNull: true },
    attempts: { type: 'integer', notNull: true, default: 0 },
    reset_at: { type: 'timestamptz', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });

  pgm.addConstraint(
    'login_rate_limit_bucket',
    'login_rate_limit_bucket_scope_check',
    `CHECK (scope IN ('CREDENTIAL', 'IP'))`
  );

  pgm.createIndex('login_rate_limit_bucket', ['reset_at']);
};

exports.down = (pgm) => {
  pgm.dropIndex('login_rate_limit_bucket', ['reset_at'], { ifExists: true });
  pgm.dropConstraint('login_rate_limit_bucket', 'login_rate_limit_bucket_scope_check', { ifExists: true });
  pgm.dropTable('login_rate_limit_bucket', { ifExists: true });
};

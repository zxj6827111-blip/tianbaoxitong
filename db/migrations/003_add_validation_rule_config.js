exports.up = (pgm) => {
  pgm.createTable('validation_rule_config', {
    rule_id: { type: 'text', primaryKey: true },
    is_enabled: { type: 'boolean', notNull: true, default: true },
    level_override: { type: 'text' },
    params_json: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });
};

exports.down = (pgm) => {
  pgm.dropTable('validation_rule_config');
};

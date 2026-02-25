exports.up = (pgm) => {
  pgm.addColumns('users', {
    managed_unit_ids: {
      type: 'uuid[]',
      notNull: true,
      default: '{}'
    },
    can_create_budget: {
      type: 'boolean',
      notNull: true,
      default: true
    },
    can_create_final: {
      type: 'boolean',
      notNull: true,
      default: true
    }
  });

  pgm.sql(`
    UPDATE users AS usr
    SET managed_unit_ids = CASE
      WHEN usr.unit_id IS NOT NULL THEN ARRAY[usr.unit_id]::uuid[]
      WHEN usr.department_id IS NOT NULL THEN COALESCE(
        (
          SELECT ARRAY_AGG(u.id ORDER BY u.sort_order ASC NULLS LAST, u.name ASC, u.id ASC)
          FROM org_unit u
          WHERE u.department_id = usr.department_id
        ),
        '{}'::uuid[]
      )
      ELSE '{}'::uuid[]
    END
  `);

  pgm.createIndex('users', ['managed_unit_ids'], {
    method: 'gin',
    name: 'users_managed_unit_ids_gin_idx'
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('users', ['managed_unit_ids'], {
    method: 'gin',
    name: 'users_managed_unit_ids_gin_idx',
    ifExists: true
  });
  pgm.dropColumns('users', ['managed_unit_ids', 'can_create_budget', 'can_create_final']);
};

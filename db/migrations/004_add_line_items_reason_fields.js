exports.up = (pgm) => {
  pgm.addColumns('line_items_reason', {
    order_no: { type: 'integer', notNull: true, default: 0 },
    updated_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' }
  });

  pgm.sql('UPDATE line_items_reason SET order_no = sort_order');
  pgm.createIndex('line_items_reason', ['draft_id', 'order_no']);
};

exports.down = (pgm) => {
  pgm.dropIndex('line_items_reason', ['draft_id', 'order_no']);
  pgm.dropColumns('line_items_reason', ['order_no', 'updated_by']);
};

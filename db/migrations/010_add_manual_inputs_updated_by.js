exports.up = (pgm) => {
    pgm.addColumns('manual_inputs', {
        updated_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' }
    });
};

exports.down = (pgm) => {
    pgm.dropColumns('manual_inputs', ['updated_by']);
};

const { DataTypes } = require('sequelize')

module.exports = {
  up: async queryInterface => {


    await queryInterface.addColumn('user_feedback_targets', 'group_ids', {
      type: DataTypes.ARRAY(DataTypes.STRING),
    })

  },
  down: async queryInterface => {
    // How to revert chances...
    await queryInterface.dropColumn('foo', 'group_ids')
  },
}
const { format } = require("date-fns")

const formatDate = (date) => format(date, 'yyyy-MM-dd')
const formatWithHours = (date) => format(date, 'yyyy-MM-dd HH:mm:ss')

module.exports = {
  formatDate,
  formatWithHours
}
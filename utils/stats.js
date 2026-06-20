function percent(data,filter){
  if (!Array.isArray(data) || data.length === 0) return '0.0';
  return ((data.filter(filter).length/data.length)*100).toFixed(1);
}

module.exports = { percent };

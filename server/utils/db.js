// server/utils/db.js
const fs = require('fs');
const path = require('path');

class SimpleDB {
  constructor(filename) {
    this.dbPath = path.resolve(filename);
    this.ensureFile();
  }

  ensureFile() {
    if (!fs.existsSync(this.dbPath)) {
      fs.writeFileSync(this.dbPath, '[]');
    }
  }

  read() {
    try {
      const data = fs.readFileSync(this.dbPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('DB read error:', error);
      return [];
    }
  }

  write(data) {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error('DB write error:', error);
      return false;
    }
  }

  insert(item) {
    const data = this.read();
    data.push({ ...item, id: item.id || Date.now().toString() });
    return this.write(data);
  }

  findById(id) {
    const data = this.read();
    return data.find(item => item.id === id);
  }

  update(id, updates) {
    const data = this.read();
    const index = data.findIndex(item => item.id === id);
    if (index !== -1) {
      data[index] = { ...data[index], ...updates };
      return this.write(data);
    }
    return false;
  }

  delete(id) {
    const data = this.read();
    const filtered = data.filter(item => item.id !== id);
    return this.write(filtered);
  }

  clear() {
    return this.write([]);
  }
}

module.exports = SimpleDB;


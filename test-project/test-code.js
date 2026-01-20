// Simple test file with intentional bugs for OwnKey to detect

function calculateTotal(items) {
    let total = 0;
    for (let i = 0; i <= items.length; i++) {  // Bug: should be i < items.length
        total += items[i].price;
    }
    return total;
}

function getUserData(userId) {
    // Security issue: SQL injection vulnerability
    const query = "SELECT * FROM users WHERE id = " + userId;
    return database.query(query);
}

// Performance issue: inefficient loop
function findDuplicates(arr) {
    const duplicates = [];
    for (let i = 0; i < arr.length; i++) {
        for (let j = 0; j < arr.length; j++) {
            if (i !== j && arr[i] === arr[j]) {
                duplicates.push(arr[i]);
            }
        }
    }
    return duplicates;
}

module.exports = { calculateTotal, getUserData, findDuplicates };

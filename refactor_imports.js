import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fixImportPath(match, prefix, quote, oldPath) {
    let newPath = oldPath;

    if (oldPath.includes('shared/models/')) {
        newPath = '../models/' + oldPath.split('shared/models/')[1];
    } else if (oldPath.includes('shared/middlewares/')) {
        newPath = '../middleware/' + oldPath.split('shared/middlewares/')[1];
    } else if (oldPath.includes('shared/config/')) {
        newPath = '../config/' + oldPath.split('shared/config/')[1];
    } else if (oldPath.includes('shared/utils/')) {
        newPath = '../utils/' + oldPath.split('shared/utils/')[1];
    } else if (oldPath.includes('services/cache.service.js')) {
        newPath = '../services/cache.service.js';
    } else if (oldPath.includes('logs/logger.js')) {
        newPath = '../logs/logger.js';
    } else if (oldPath.includes('services/notification.service.js')) {
        newPath = '../services/notification.service.js';
    } else if (oldPath.includes('services/twilio.service.js')) {
        newPath = '../services/twilio.service.js';
    } else if (oldPath.includes('services/user-service/services/')) {
        newPath = '../services/' + oldPath.split('services/user-service/services/')[1];
    } else if (oldPath.includes('services/user-service/routes/')) {
        newPath = '../routes/' + oldPath.split('services/user-service/routes/')[1];
    } else if (oldPath.match(/(\.\.\/)+controllers\//)) {
        newPath = '../controllers/' + oldPath.split('controllers/')[1];
    } else if (oldPath.match(/(\.\.\/)+validators\//)) {
        newPath = '../validators/' + oldPath.split('validators/')[1];
    } else if (oldPath.includes('../controllers/')) { 
        newPath = '../controllers/' + oldPath.split('../controllers/')[1];
    } else if (oldPath.match(/(\.\.\/)+socket\.js/)) {
        newPath = '../socket.js';
    } 
    // Handle things that were at root
    else if (oldPath === '../../../../socket.js' || oldPath === '../../../socket.js' || oldPath === '../../socket.js' || oldPath === '../socket.js') {
        newPath = '../socket.js';
    }

    if (newPath !== oldPath) {
       return `${prefix}${quote}${newPath}${quote}`;
    }
    return match;
}

function processDirectory(dir, depth = 1) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            processDirectory(fullPath, depth + 1);
        } else if (fullPath.endsWith('.js')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let newContent = content.replace(/(from\s+|import\s*\(\s*)(['"])(.*?)\2/g, (match, prefix, quote, p3) => fixImportPath(match, prefix, quote, p3));
            
            if (content !== newContent) {
                fs.writeFileSync(fullPath, newContent);
                console.log(`Updated imports in: ${fullPath.replace(__dirname, '')}`);
            }
        }
    }
}

processDirectory(path.join(__dirname, 'src'));
console.log('DONE!');

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// Multer Setup for Image Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'public/uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 500 * 1024 * 1024 } // Allow larger size for videos (up to 500MB)
});

const propertyUploads = upload.fields([
    { name: 'images', maxCount: 10 },
    { name: 'promoVideo', maxCount: 1 }
]);

// Helper functions for JSON database
const readJSON = (filename) => {
    const filePath = path.join(__dirname, 'data', filename);
    if (!fs.existsSync(filePath)) return [];
    const data = fs.readFileSync(filePath, 'utf8');
    return data ? JSON.parse(data) : [];
};

const writeJSON = (filename, data) => {
    const filePath = path.join(__dirname, 'data', filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
};

let currentUser = null; // Simulated logged-in user session

app.use((req, res, next) => {
    res.locals.currentUser = currentUser;
    next();
});

// ==================== ROUTES ====================

// Home: Search & List Properties
app.get('/', (req, res) => {
    let properties = readJSON('properties.json');
    const { location, maxPrice } = req.query;

    if (location) {
        properties = properties.filter(p => p.location.toLowerCase().includes(location.toLowerCase()));
    }
    if (maxPrice) {
        properties = properties.filter(p => Number(p.price) <= Number(maxPrice));
    }

    res.render('index', { properties, query: req.query });
});

// Property Details Page
app.get('/property/:id', (req, res) => {
    const properties = readJSON('properties.json');
    const property = properties.find(p => p.id === req.params.id);
    if (!property) return res.status(404).send('Property not found');
    res.render('property-detail', { property });
});

// Authentication Routes
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    const users = readJSON('users.json');
    const user = users.find(u => u.email === email && u.password === password);
    if (!user) {
        return res.render('login', { error: 'Invalid email or password' });
    }
    currentUser = user;
    if (user.role === 'admin') {
        res.redirect('/admin');
    } else {
        res.redirect('/user/dashboard');
    }
});

app.get('/register', (req, res) => res.render('register', { error: null }));

app.post('/register', (req, res) => {
    const { firstName, lastName, phone, email, password, website, sliderVerified } = req.body;

    // 1. Check Honeypot spam bot
    if (website && website.trim() !== "") {
        return res.status(400).render('register', { error: 'Automated submission detected.', currentUser: null });
    }

    // 2. Check Slider CAPTCHA verification
    if (sliderVerified !== 'true') {
        return res.status(400).render('register', { error: 'Please complete the slide verification.', currentUser: null });
    }

    // 3. Server-side Password Criteria Check
    const passwordRegex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!password || !passwordRegex.test(password)) {
        return res.status(400).render('register', { 
            error: 'Password must be at least 8 characters long and contain at least one uppercase letter and one number.', 
            currentUser: null 
        });
    }

    // 4. Existing User Verification & Registration Logic
    const users = readJSON('users.json');
    if (users.some(u => u.email === email)) {
        return res.render('register', { error: 'Email already exists', currentUser: null });
    }

    const fullName = `${firstName.trim()} ${lastName.trim()}`;
    const newUser = { 
        id: Date.now().toString(), 
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        name: fullName, 
        phone: phone.trim(),
        email, 
        password, 
        role: 'user' 
    };

    users.push(newUser);
    writeJSON('users.json', users);
    currentUser = newUser;
    res.redirect('/user/dashboard');
});

// Admin reply to a user message thread
app.post('/admin/message/reply', (req, res) => {
    if (!currentUser || currentUser.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
    const { conversationId, message } = req.body;
    if (!message || !conversationId) return res.status(400).json({ error: 'Missing data' });

    const conversations = readJSON('messages.json');
    const convo = conversations.find(c => c.conversationId === conversationId);
    if (!convo) return res.status(404).json({ error: 'Conversation not found' });

    const newMsg = {
        id: Date.now().toString(),
        sender: 'admin',
        message,
        date: new Date().toISOString()
    };
    convo.messages.push(newMsg);
    writeJSON('messages.json', conversations);
    res.json({ success: true, message: newMsg });
});

app.get('/logout', (req, res) => {
    currentUser = null;
    res.redirect('/');
});

// ==================== USER PORTAL ====================
app.get('/user/dashboard', (req, res) => {
    if (!currentUser || currentUser.role !== 'user') return res.redirect('/login');
    const reservations = readJSON('reservations.json').filter(r => r.userId === currentUser.id);
    const properties = readJSON('properties.json');
    const messages = readJSON('messages.json').filter(c => c.userId === currentUser.id);
    
    res.render('user-dashboard', { reservations, properties, messages });
});

app.post('/user/message/reply', (req, res) => {
    if (!currentUser || currentUser.role !== 'user') return res.status(403).json({ error: 'Unauthorized' });
    const { conversationId, message } = req.body;
    if (!message || !conversationId) return res.status(400).json({ error: 'Missing data' });

    const conversations = readJSON('messages.json');
    const convo = conversations.find(c => c.conversationId === conversationId);
    if (!convo) return res.status(404).json({ error: 'Conversation not found' });

    const newMsg = {
        id: Date.now().toString(),
        sender: 'user',
        message,
        date: new Date().toISOString()
    };
    convo.messages.push(newMsg);
    writeJSON('messages.json', conversations);
    res.json({ success: true, message: newMsg });
});

// Send message to property host
app.post('/property/:id/message', (req, res) => {
    if (!currentUser) return res.redirect('/login');
    const { message } = req.body;
    const propertyId = req.params.id;
    const userId = currentUser.id;
    const userName = currentUser.name;
    const conversationId = `${userId}_${propertyId}`;

    const conversations = readJSON('messages.json');
    let convo = conversations.find(c => c.conversationId === conversationId);

    const newMsg = {
        id: Date.now().toString(),
        sender: 'user',
        message,
        date: new Date().toISOString()
    };

    if (convo) {
        convo.messages.push(newMsg);
    } else {
        conversations.push({
            conversationId,
            userId,
            userName,
            propertyId,
            messages: [newMsg]
        });
    }

    writeJSON('messages.json', conversations);
    res.redirect(`/property/${propertyId}?msg=sent`);
});

// Request reservation
app.post('/property/:id/reserve', (req, res) => {
    if (!currentUser) return res.redirect('/login');
    const { checkIn, checkOut } = req.body;
    const reservations = readJSON('reservations.json');
    reservations.push({
        id: Date.now().toString(),
        propertyId: req.params.id,
        userId: currentUser.id,
        userName: currentUser.name,
        checkIn,
        checkOut,
        status: 'Pending'
    });
    writeJSON('reservations.json', reservations);
    res.redirect('/user/dashboard');
});

// ==================== ADMIN PORTAL ====================
// ==================== ADMIN PORTAL ====================
app.get('/admin', (req, res) => {
    if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
    const properties = readJSON('properties.json');
    const reservations = readJSON('reservations.json');
    const messages = readJSON('messages.json'); // Array of conversation objects
    
    const users = readJSON('users.json')
        .filter(u => u.role === 'user')
        .map(u => {
            const userReservations = reservations.filter(r => r.userId === u.id);
            const userConversations = messages.filter(c => c.userId === u.id);

            let fName = u.firstName;
            let lName = u.lastName;
            if (!fName && !lName && u.name) {
                const parts = u.name.trim().split(' ');
                fName = parts[0] || '';
                lName = parts.slice(1).join(' ') || '';
            }

            return {
                ...u,
                firstName: fName || 'N/A',
                lastName: lName || '',
                phone: u.phone || 'N/A',
                reservationsCount: userReservations.length,
                conversationsCount: userConversations.length
            };
        });

    res.render('admin/admin-dashboard', { properties, reservations, messages, users });
});

// Update Reservation Status (Single switch)
app.post('/admin/reservation/:id/status', (req, res) => {
    if (!currentUser || currentUser.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
    const { status } = req.body;
    
    const reservations = readJSON('reservations.json');
    const resv = reservations.find(r => r.id === req.params.id);
    if (!resv) return res.json({ success: false, error: 'Reservation not found' });

    const oldStatus = resv.status;
    resv.status = status;
    writeJSON('reservations.json', reservations);

    // If status changed to 'Accepted', automatically make dates unavailable in the property calendar
    if (status === 'Accepted' && oldStatus !== 'Accepted') {
        const properties = readJSON('properties.json');
        const property = properties.find(p => p.id === resv.propertyId);
        
        if (property) {
            if (!property.unavailableDates) {
                property.unavailableDates = [];
            }

            // Calculate all dates in the range from checkIn to checkOut
            let curr = new Date(resv.checkIn);
            const endD = new Date(resv.checkOut);

            while (curr <= endD) {
                const dateStr = curr.toISOString().split('T')[0];
                if (!property.unavailableDates.includes(dateStr)) {
                    property.unavailableDates.push(dateStr);
                }
                curr.setDate(curr.getDate() + 1);
            }

            // Sort dates chronologically
            property.unavailableDates.sort();
            writeJSON('properties.json', properties);
        }
    }

    res.json({ success: true });
});

// Real-time Save Admin Note for Reservation
app.post('/admin/reservation/:id/note', (req, res) => {
    if (!currentUser || currentUser.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
    const { note } = req.body;
    const reservations = readJSON('reservations.json');
    const resv = reservations.find(r => r.id === req.params.id);
    if (resv) {
        resv.note = note || '';
        writeJSON('reservations.json', reservations);
    }
    res.json({ success: true });
});

// Delete Reservation
app.post('/admin/reservation/:id/delete', (req, res) => {
    if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
    let reservations = readJSON('reservations.json');
    reservations = reservations.filter(r => r.id !== req.params.id);
    writeJSON('reservations.json', reservations);
    res.redirect('/admin');
});

// Delete Property Route (Removes from JSON & unlinks images/videos from disk)
app.post('/admin/property/delete/:id', (req, res) => {
    if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
    let properties = readJSON('properties.json');
    const index = properties.findIndex(p => p.id === req.params.id);
    
    if (index !== -1) {
        const prop = properties[index];

        // Delete images from disk
        if (prop.images && Array.isArray(prop.images)) {
            prop.images.forEach(img => {
                const imgPath = path.join(__dirname, 'public/uploads', img);
                if (fs.existsSync(imgPath)) {
                    try { fs.unlinkSync(imgPath); } catch (err) { console.error(err); }
                }
            });
        }
        // Also check legacy single image field just in case
        if (prop.image && prop.image !== 'default-chalet.jpg') {
            const singleImgPath = path.join(__dirname, 'public/uploads', prop.image);
            if (fs.existsSync(singleImgPath)) {
                try { fs.unlinkSync(singleImgPath); } catch (err) { console.error(err); }
            }
        }

        // Delete promo video from disk if it exists
        if (prop.promoVideo) {
            const videoPath = path.join(__dirname, 'public/uploads', prop.promoVideo);
            if (fs.existsSync(videoPath)) {
                try { fs.unlinkSync(videoPath); } catch (err) { console.error(err); }
            }
        }

        // Remove from array and write back to JSON
        properties.splice(index, 1);
        writeJSON('properties.json', properties);
    }
    res.redirect('/admin');
});

// Delete User Route
app.post('/admin/user/:id/delete', (req, res) => {
    if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
    let users = readJSON('users.json');
    users = users.filter(u => u.id !== req.params.id);
    writeJSON('users.json', users);
    res.redirect('/admin');
});

// Add Property Form (GET)
app.get('/admin/property/add', (req, res) => {
    if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
    res.render('admin/admin-add-property', { property: null });
});

// Save New Property (POST)
app.post('/admin/property/add', propertyUploads, (req, res) => {
    if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
    const { 
        title, location, price, description, propertyType, guestsCapacity, 
        sleepingArrangements, bathrooms, squareFeet, exactAddress, 
        houseRules, devices, bookingRules, comingLeavingRules, otherDetails 
    } = req.body;

    const properties = readJSON('properties.json');
    
    const images = req.files['images'] ? req.files['images'].map(file => file.filename) : [];
    const promoVideo = req.files['promoVideo'] ? req.files['promoVideo'][0].filename : null;

    const newProperty = {
        id: Date.now().toString(),
        title,
        location,
        price: Number(price),
        description,
        propertyType,
        guestsCapacity: Number(guestsCapacity),
        sleepingArrangements,
        bathrooms: Number(bathrooms),
        squareFeet: Number(squareFeet),
        exactAddress,
        houseRules,
        devices,
        bookingRules,
        comingLeavingRules,
        otherDetails,
        images,
        image: images.length > 0 ? images[0] : 'default-chalet.jpg',
        promoVideo,
        unavailableDates: []
    };

    properties.push(newProperty);
    writeJSON('properties.json', properties);
    res.redirect('/admin');
});

// Edit Property Form (GET) - FIXED: This route was missing!
app.get('/admin/property/edit/:id', (req, res) => {
    if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
    const properties = readJSON('properties.json');
    const property = properties.find(p => p.id === req.params.id);
    if (!property) return res.status(404).send('Property not found');
    res.render('admin/admin-add-property', { property });
});

// Update Property (POST)
app.post('/admin/property/edit/:id', propertyUploads, (req, res) => {
    if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
    const properties = readJSON('properties.json');
    const index = properties.findIndex(p => p.id === req.params.id);
    if (index === -1) return res.status(404).send('Property not found');

    const { 
        title, location, price, description, propertyType, guestsCapacity, 
        sleepingArrangements, bathrooms, squareFeet, exactAddress, 
        houseRules, devices, bookingRules, comingLeavingRules, otherDetails,
        existingImagesOrder, deletePromoVideo 
    } = req.body;

    const prop = properties[index];

    prop.title = title;
    prop.location = location;
    prop.price = Number(price);
    prop.description = description;
    prop.propertyType = propertyType;
    prop.guestsCapacity = Number(guestsCapacity);
    prop.sleepingArrangements = sleepingArrangements;
    prop.bathrooms = Number(bathrooms);
    prop.squareFeet = Number(squareFeet);
    prop.exactAddress = exactAddress;
    prop.houseRules = houseRules;
    prop.devices = devices;
    prop.bookingRules = bookingRules;
    prop.comingLeavingRules = comingLeavingRules;
    prop.otherDetails = otherDetails;

    // Process retained images and delete unreferenced ones from disk
    let retainedImages = [];
    if (existingImagesOrder) {
        try {
            retainedImages = JSON.parse(existingImagesOrder);
        } catch (e) {
            retainedImages = prop.images || [];
        }
    }

    if (prop.images && Array.isArray(prop.images)) {
        prop.images.forEach(oldImg => {
            if (!retainedImages.includes(oldImg)) {
                const imgPath = path.join(__dirname, 'public/uploads', oldImg);
                if (fs.existsSync(imgPath)) {
                    try { fs.unlinkSync(imgPath); } catch (err) { console.error(err); }
                }
            }
        });
    }

    let newImages = [];
    if (req.files && req.files['images'] && req.files['images'].length > 0) {
        newImages = req.files['images'].map(file => file.filename);
    }

    prop.images = [...retainedImages, ...newImages];
    prop.image = prop.images.length > 0 ? prop.images[0] : 'default-chalet.jpg';

    // Handle Promo Video deletion or replacement from disk & JSON
    if (deletePromoVideo === '1' || deletePromoVideo === 'true') {
        if (prop.promoVideo) {
            const videoPath = path.join(__dirname, 'public/uploads', prop.promoVideo);
            if (fs.existsSync(videoPath)) {
                try { fs.unlinkSync(videoPath); } catch (err) { console.error(err); }
            }
        }
        prop.promoVideo = null;
    }

    if (req.files && req.files['promoVideo'] && req.files['promoVideo'].length > 0) {
        if (prop.promoVideo) {
            const oldVideoPath = path.join(__dirname, 'public/uploads', prop.promoVideo);
            if (fs.existsSync(oldVideoPath)) {
                try { fs.unlinkSync(oldVideoPath); } catch (err) { console.error(err); }
            }
        }
        prop.promoVideo = req.files['promoVideo'][0].filename;
    }

    properties[index] = prop;
    writeJSON('properties.json', properties);
    res.redirect('/admin');
});

// Real-time Property Reordering Route
app.post('/admin/properties/reorder', (req, res) => {
    if (!currentUser || currentUser.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
    const { order } = req.body; // Array of property IDs in new order
    if (!Array.isArray(order)) return res.status(400).json({ error: 'Invalid data' });

    const properties = readJSON('properties.json');
    // Sort properties array according to the new order array
    properties.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    writeJSON('properties.json', properties);
    res.json({ success: true });
});

// Edit Calendar / Unavailable Dates
app.post('/admin/property/calendar/:id', (req, res) => {
    if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
    const { unavailableDates } = req.body; 
    const properties = readJSON('properties.json');
    const property = properties.find(p => p.id === req.params.id);
    if (property) {
        property.unavailableDates = unavailableDates ? unavailableDates.split(',').map(d => d.trim()) : [];
        writeJSON('properties.json', properties);
    }
    res.redirect('/admin');
});

// Accept or Decline Reservations
app.post('/admin/reservation/:id/:action', (req, res) => {
    if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
    const { id, action } = req.params;
    const reservations = readJSON('reservations.json');
    const reservation = reservations.find(r => r.id === id);
    if (reservation) {
        reservation.status = action === 'accept' ? 'Accepted' : 'Declined';
        writeJSON('reservations.json', reservations);
    }
    res.redirect('/admin');
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
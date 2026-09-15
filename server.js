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
const upload = multer({ storage: storage });

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

// Simple Cookie/Session simulation via query/in-memory or simplified header mock
// For a fully working basic app without complex session packages, we will store simulated user state via simple memory or client requests. Let's use simple in-memory session tracking by IP/token or store user info in request locals.
// To keep it dead-simple and standard for basic template apps:
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
    const { name, email, password } = req.body;
    const users = readJSON('users.json');
    if (users.some(u => u.email === email)) {
        return res.render('register', { error: 'Email already exists' });
    }
    const newUser = { id: Date.now().toString(), name, email, password, role: 'user' };
    users.push(newUser);
    writeJSON('users.json', users);
    currentUser = newUser;
    res.redirect('/user/dashboard');
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
    res.render('user-dashboard', { reservations, properties });
});

// Send message to property host
app.post('/property/:id/message', (req, res) => {
    if (!currentUser) return res.redirect('/login');
    const { message } = req.body;
    const messages = readJSON('messages.json');
    messages.push({
        id: Date.now().toString(),
        propertyId: req.params.id,
        userId: currentUser.id,
        userName: currentUser.name,
        message,
        date: new Date().toISOString()
    });
    writeJSON('messages.json', messages);
    res.redirect(`/property/${req.params.id}?msg=sent`);
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
app.get('/admin', (req, res) => {
    if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
    const properties = readJSON('properties.json');
    const reservations = readJSON('reservations.json');
    const messages = readJSON('messages.json');
    const users = readJSON('users.json').filter(u => u.role === 'user');
    res.render('admin-dashboard', { properties, reservations, messages, users });
});

// Add Property Form
app.get('/admin/property/add', (req, res) => {
    if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
    res.render('admin-add-property', { property: null });
});

// Save New Property
app.post('/admin/property/add', upload.single('image'), (req, res) => {
    if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
    const { title, location, price, description } = req.body;
    const properties = readJSON('properties.json');
    const newProperty = {
        id: Date.now().toString(),
        title,
        location,
        price: Number(price),
        description,
        image: req.file ? req.file.filename : 'default-chalet.jpg',
        unavailableDates: []
    };
    properties.push(newProperty);
    writeJSON('properties.json', properties);
    res.redirect('/admin');
});

// Edit Property Form
app.get('/admin/property/edit/:id', (req, res) => {
    if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
    const properties = readJSON('properties.json');
    const property = properties.find(p => p.id === req.params.id);
    if (!property) return res.status(404).send('Property not found');
    res.render('admin-add-property', { property });
});

// Update Property
app.post('/admin/property/edit/:id', upload.single('image'), (req, res) => {
    if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
    const properties = readJSON('properties.json');
    const index = properties.findIndex(p => p.id === req.params.id);
    if (index === -1) return res.status(404).send('Property not found');

    const { title, location, price, description } = req.body;
    properties[index].title = title;
    properties[index].location = location;
    properties[index].price = Number(price);
    properties[index].description = description;
    if (req.file) {
        properties[index].image = req.file.filename;
    }
    writeJSON('properties.json', properties);
    res.redirect('/admin');
});

// Edit Calendar / Unavailable Dates
app.post('/admin/property/calendar/:id', (req, res) => {
    if (!currentUser || currentUser.role !== 'admin') return res.redirect('/login');
    const { unavailableDates } = req.body; // comma separated dates e.g. "2026-10-01, 2026-10-02"
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
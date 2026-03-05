const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const db = new sqlite3.Database('./db.db');

const DISCORD_CLIENT_ID = '1478975523110780958';
const DISCORD_CLIENT_SECRET = 'typoOZelW9QhY5k56QoFS8Dw47jdHGpm';
const DISCORD_REDIRECT_URI = process.env.REDIRECT_URI || 'https://batmansai.onrender.com/callback';
const DISCORD_GUILD_ID = '1437546471766622380';

app.use(cors({
    origin: ['http://localhost:3000', 'https://batmansai.netlify.app'],
    credentials: true
}));
app.use(express.json());

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        email TEXT,
        role TEXT,
        bio TEXT,
        pfp TEXT,
        banned INTEGER,
        discordId TEXT UNIQUE,
        createdAt TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS announcements (
        id TEXT PRIMARY KEY,
        title TEXT,
        message TEXT,
        author TEXT,
        date TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);
});

function generateUserId() {
    return 'USR' + Math.random().toString(36).substr(2, 9).toUpperCase();
}

app.get('/callback', async (req, res) => {
    const { code, error } = req.query;
    
    if (error) {
        console.log('Discord OAuth error:', error);
        return res.redirect(`https://batmansai.netlify.app/login.html?error=${error}`);
    }
    
    if (!code) {
        return res.redirect('https://batmansai.netlify.app/login.html?error=no_code');
    }
    
    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', 
            new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: DISCORD_REDIRECT_URI
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { access_token } = tokenResponse.data;
        
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const discordUser = userResponse.data;
        const userId = 'USR' + Math.random().toString(36).substr(2, 9).toUpperCase();
        
        db.get(`SELECT * FROM users WHERE discordId = ?`, [discordUser.id], (err, user) => {
            if (user) {
                if (user.banned) {
                    return res.redirect('https://batmansai.netlify.app/login.html?error=banned');
                }
                const updatedUser = {
                    ...user,
                    pfp: discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png` : user.pfp,
                    username: discordUser.username
                };
                db.run(`UPDATE users SET pfp = ?, username = ? WHERE id = ?`, [updatedUser.pfp, updatedUser.username, user.id], () => {
                    res.redirect(`https://batmansai.netlify.app?user=${encodeURIComponent(JSON.stringify(updatedUser))}`);
                });
            } else {
                const newUser = {
                    id: userId,
                    username: discordUser.username,
                    email: discordUser.email || '',
                    role: 'user',
                    bio: '',
                    pfp: discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png` : 'https://via.placeholder.com/150',
                    banned: 0,
                    discordId: discordUser.id,
                    createdAt: new Date().toISOString()
                };
                
                db.run(`INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [newUser.id, newUser.username, newUser.email, newUser.role, newUser.bio, newUser.pfp, newUser.banned, newUser.discordId, newUser.createdAt],
                    () => {
                        res.redirect(`https://batmansai.netlify.app?user=${encodeURIComponent(JSON.stringify(newUser))}`);
                    });
            }
        });
    } catch (error) {
        console.error('Discord OAuth Error:', error.response?.data || error.message);
        res.redirect('https://batmansai.netlify.app/login.html?error=auth_failed');
    }
});

app.post('/api/signup', (req, res) => {
    const { username, password, email } = req.body;
    const id = generateUserId();
    
    db.run(`INSERT INTO users VALUES (?, ?, ?, ?, 'user', '', 'https://via.placeholder.com/150', 0, ?)`,
        [id, username, password, email, new Date().toISOString()],
        function(err) {
            if (err) return res.json({ success: false, message: 'Username already exists' });
            res.json({ success: true, user: { id, username, email, role: 'user' } });
        });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, user) => {
        if (!user) return res.json({ success: false, message: 'Invalid credentials' });
        if (user.banned) return res.json({ success: false, message: 'Account banned' });
        res.json({ success: true, user });
    });
});

app.get('/api/users', (req, res) => {
    db.all(`SELECT * FROM users`, [], (err, users) => {
        res.json(users || []);
    });
});

app.post('/api/ban', (req, res) => {
    const { userId } = req.body;
    db.run(`UPDATE users SET banned = 1 WHERE id = ?`, [userId], () => {
        res.json({ success: true });
    });
});

app.post('/api/unban', (req, res) => {
    const { discordId } = req.body;
    db.run(`UPDATE users SET banned = 0 WHERE discordId = ?`, [discordId], () => {
        res.json({ success: true });
    });
});

app.post('/api/announcement', (req, res) => {
    const { title, message, author } = req.body;
    const id = generateUserId();
    
    db.run(`INSERT INTO announcements VALUES (?, ?, ?, ?, ?)`,
        [id, title, message, author, new Date().toISOString()], () => {
            res.json({ success: true });
        });
});

app.get('/api/announcements', (req, res) => {
    db.all(`SELECT * FROM announcements ORDER BY date DESC`, [], (err, announcements) => {
        res.json(announcements || []);
    });
});

app.post('/api/profile', (req, res) => {
    const { id, pfp, username, bio } = req.body;
    db.run(`UPDATE users SET pfp = ?, username = ?, bio = ? WHERE id = ?`, [pfp, username, bio, id], () => {
        res.json({ success: true });
    });
});

app.get('/api/announcement/latest', (req, res) => {
    db.get(`SELECT value FROM settings WHERE key = 'announcement'`, [], (err, row) => {
        res.json(row?.value ? { text: row.value } : {});
    });
});

app.post('/api/announcement/set', (req, res) => {
    const { text } = req.body;
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('announcement', ?)`, [text], () => {
        res.json({ success: true });
    });
});

app.post('/api/announcement/clear', (req, res) => {
    db.run(`DELETE FROM settings WHERE key = 'announcement'`, [], () => {
        res.json({ success: true });
    });
});

app.get('/api/settings/maintenance', (req, res) => {
    db.get(`SELECT value FROM settings WHERE key = 'maintenance'`, [], (err, row) => {
        res.json({ enabled: row?.value === 'true' });
    });
});

app.post('/api/settings/maintenance', (req, res) => {
    const { enabled } = req.body;
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('maintenance', ?)`, [enabled.toString()], () => {
        res.json({ success: true });
    });
});

app.post('/api/announcements/clear', (req, res) => {
    db.run(`DELETE FROM announcements`, [], () => {
        res.json({ success: true });
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('maintenance', 'false')`);
    console.log(`Server running on port ${PORT}`);
});

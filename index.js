var express = require('express');
var session = require('express-session');
var ejs = require('ejs');
var bodyParser = require('body-parser');
var mysql = require('mysql');
var app = express();

// ✅ Create a single database connection
var con = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database: "internproject"
});

con.connect(function(err) {
    if (err) {
        console.error("Error connecting to MySQL:", err.message);
        return;
    }
    console.log("Connected to MySQL database.");
});

// ✅ Use express-session only once
app.use(session({
    secret: 'secret',
    resave: false,  // Fix warning
    saveUninitialized: false  // Fix warning
}));

// ✅ Middleware
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));

// ✅ Utility Functions
function isProductInCart(cart, id) {
    return cart.some(product => product.id == id);
}

function calculateTotal(cart, req) {
    let total = cart.reduce((sum, item) => {
        return sum + ((item.sale_price || item.price) * item.quantity);
    }, 0);
    req.session.total = total;
    return total;
}

// ✅ Home Route
app.get('/', function(req, res) {
    con.query("SELECT * FROM products", (err, result) => {
        if (err) {
            console.error("Error fetching products: " + err.message);
            res.status(500).send("Database error");
            return;
        }
        res.render('pages/index', { result });
    });
});

// ✅ Add to Cart
app.post('/add_to_cart', function(req, res) {
    var { id, name, price, sale_price, quantity, image } = req.body;
    var product = { id, name, price, sale_price, quantity, image };

    req.session.cart = req.session.cart || [];
    
    if (!isProductInCart(req.session.cart, id)) {
        req.session.cart.push(product);
    }

    calculateTotal(req.session.cart, req);
    res.redirect('/cart');
});

// ✅ Remove Product from Cart
app.post('/remove_product', function(req, res) {
    let productId = req.body.id;
    req.session.cart = req.session.cart?.filter(item => item.id !== productId) || [];
    calculateTotal(req.session.cart, req);
    res.redirect('/cart');
});

// ✅ Cart Page
app.get('/cart', function(req, res) {
    var cart = req.session.cart || [];
    var total = req.session.total || 0;
    res.render('pages/cart', { cart, total });
});

// ✅ Edit Product Quantity
app.post('/edit_product_quantity', function(req, res) {
    var { id, increase_product_quantity, decrease_product_quantity } = req.body;
    var cart = req.session.cart;

    for (let i = 0; i < cart.length; i++) {
        if (cart[i].id == id) {
            if (increase_product_quantity) {
                cart[i].quantity = parseInt(cart[i].quantity) + 1;
            }
            if (decrease_product_quantity && cart[i].quantity > 1) {
                cart[i].quantity = parseInt(cart[i].quantity) - 1;
            }
        }
    }
    calculateTotal(cart, req);
    res.redirect('/cart');
});

// ✅ Checkout Page
app.get('/checkout', function(req, res) {
    var total = req.session.total || 0;
    res.render('pages/checkout', { total });
});
// ✅ Place Order (Fixing Connection Issues)
app.post('/place_order', function(req, res) {
    var { name, email, phone, city, address } = req.body;
    var cost = req.session.total || 0;
    var status = "not paid";
    var formattedDate = new Date().toISOString().split('T')[0];

    var cart = req.session.cart || [];
    var products_ids = cart.map(item => item.id).join(','); // ✅ Convert cart product IDs to a string

    var id = Date.now(); // ✅ Ensure `id` is defined before use
    req.session.order_id = id;

    if (!products_ids || products_ids === "") {
        products_ids = "NULL"; // ✅ Ensure a value is provided to avoid SQL errors
    }

    var orderQuery = "INSERT INTO orders (id, cost, name, email, status, city, address, phone, date, products_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    var orderValues = [id, cost, name, email, status, city, address, phone, formattedDate, products_ids];

    con.query(orderQuery, orderValues, (err, result) => {
        if (err) {
            console.error("Error inserting order:", err);
            res.send("Error placing order.");
        } else {
            console.log("Order placed successfully, Order ID:", id);

            // ✅ Insert order items separately in `orders_item` table
            if (cart.length > 0) {
                let orderItemQuery = "INSERT INTO orders_item (order_id, product_id, product_name, product_price, product_image, product_quantity, order_date) VALUES ?";
                let orderItemValues = cart.map(item => [
                    id, item.id, item.name, item.price, item.image, item.quantity, formattedDate
                ]);

                con.query(orderItemQuery, [orderItemValues], (err, result) => {
                    if (err) {
                        console.error("Error inserting order items:", err);
                        res.send("Error adding order items.");
                    } else {
                        console.log("Order items added successfully!");
                        res.redirect('/payment');
                    }
                });
            } else {
                res.redirect('/payment');
            }
        }
    });
});


// ✅ Payment Page
app.get('/payment', function(req, res) {
    var total = req.session.total || 0;
    res.render('pages/payment',{total:total});
});

app.get('/verify_payment', function(req, res) {
    const transaction_id = req.query.transaction_id;
    const order_id = req.session.order_id;
    const date = new Date();

    if (!transaction_id || !order_id) {
        return res.status(400).send("Invalid payment verification data");
    }

    const values = [[order_id, transaction_id, date]];

    const paymentQuery = "INSERT INTO payments (order_id, transaction_id, date) VALUES ?";
    con.query(paymentQuery, [values], (err, result) => {
        if (err) {
            console.error("Error saving payment:", err);
            return res.send("Error saving payment");
        }

        // Update order status
        con.query("UPDATE orders SET status = 'paid' WHERE id = ?", [order_id], (err, result) => {
            if (err) {
                console.error("Error updating order status:", err);
                return res.send("Error updating order status");
            }

            res.redirect("/thank_you");
        });
    });
});

app.get("/thank_you",function(req,res){
    var order_id =  req.session.order_id;
    var total = req.session.total || 0; 
    res.render("pages/thank_you",{order_id:order_id,total: total})
})

app.get('/single_product', function(req, res) {
    const id = req.query.id;
  
    const con = mysql.createConnection({
      host: "localhost",
      user: "root",
      password: "",
      database: "internproject"
    });
  
    con.connect();
  
    con.query("SELECT * FROM products WHERE id = ?", [id], (err, result) => {
      if (err) {
        console.error("Error fetching product: " + err.message);
        return res.status(500).send("Database error");
      }
  
      if (result.length === 0) {
        return res.status(404).send("Product not found");
      }
  
      res.render('pages/single_product', { item: result[0] }); // ✅ Pass single product
    });
  });
  
  


    app.get('/products', function (req, res){

        var con = mysql. createConnection({
            host:"localhost", user: "root", password:"", database: "internproject" 
        })

        con.query("SELECT * FROM products", (err, result) => {
            if (err) {
                console.error("Error fetching products: " + err.message);
                res.status(500).send("Database error");
                return;
            }
            res.render('pages/products', { result });
        });

    });

    app.get('/about', function(req, res){
    res.render('pages/about');

    });
// ✅ Start Server
app.listen(8080, () => {
    console.log("Server running on http://localhost:8080");
});

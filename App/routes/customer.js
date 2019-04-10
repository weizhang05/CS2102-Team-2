let express = require('express');
let pool = require('../pool');
let router = express.Router();

// Check if making a booking at a branch is possible
// 1) check if start/end booking time is in operating hours
// 		4 cases:
//		 	1) booking_start is on start_day
//		 	booking_end is before end_day
//		 	2) booking_start is after start day
//		 	booking_end is on end_day
//		 	3) booking_start is on start_day
//		 	booking_end is on end_day
//		 	4) book_start is after start_day
//		 	book_end is before end_day
// 2) check if branch has capacity
// 3) check operating hours override

// $1 = branch id
// $2 = start_day (int 0-6)
// $3 = start_time (time)
// $4 = end_day
// $5 = end_time
// $6 = start_ts (timestamp)
// $7 = end_ts
// $8 = booking_pax
const CHECK_BRANCH_AVAILABILITY_QUERY = `
SELECT 1
FROM opening_hours op1
WHERE op1.branch_id = $1 and
EXISTS (
  select 1
  FROM opening_hours op2
  WHERE op2.branch_id = op1.branch_id
  AND (
  (op2.start_day = $2
  AND op2.start_time <= $3
  AND op2.end_day > $4)
  OR
  (op2.start_day < $2
  AND op2.end_time >= $5
  AND op2.end_day = $4)
  OR
  (op2.start_day = $2
  AND op2.end_day = $4
  AND op2.start_time <= $3 
  AND op2.end_time >= $5)
  OR
  (op2.start_day < $2
  AND op2.end_day > $4)
	)
) AND 
EXISTS (
	select 1
	FROM branch br
	WHERE br.id = op1.branch_id
	AND 
      br.capacity - $8 >= 
      (SELECT COALESCE(SUM(bk.pax), 0)
        FROM booking bk
        WHERE br.id = bk.branch_id
        AND bk.throughout && tsrange($6, $7, '[)'))
)
`;

const MAKE_BOOKING_QUERY = `
INSERT INTO booking(customer_id, branch_id, pax, throughout)
VALUES($1, $2, $3, tsrange($4, $5, '[)'))
`;

const GET_RESTAURANT_BRANCHES_QUERY = `
SELECT b.id id, restaurant_name, b.name, address, plus_code 
FROM branch b join restaurant r
ON b.restaurant_id = r.id
WHERE b.restaurant_id = $1
`;



// Index
function goIndex(req, res) {
  if(req.cookies.customer){
    res.render('customerIndexAfterLogin', { title: 'CS2102 Restaurant' });
  }
  else{
    res.render('customerIndexBeforeLogin', { title: 'CS2102 Restaurant' });
  }
}

router.get('/', function(req, res, next) {
	goIndex(req, res)
});

router.post('/', function(req, res, next) {
  goIndex(req, res)
});

router.get('/customer', function(req, res, next) {
	goIndex(req, res)
});

router.post('/customer', function(req, res, next) {
  goIndex(req, res)
});

// Register
router.get('/customer/register', function(req, res, next) {
  res.render('register', { title: 'Register' });
});

router.post('/customer/register', function(req, res, next) {
	var name = req.body.name;
	var email = req.body.email;
	var pw = req.body.password;
	var confirmPw = req.body.confirmPassword;
	
	var accountExistQuery = "SELECT * FROM customer WHERE '"+email+"' = email";
	
	pool.query(accountExistQuery, (err, data) => {
		if(data["rowCount"] === 1){
			console.log("User exists!");
		}
		else{
			var createAccountQuery = "INSERT INTO customer(name, email, password, non_user) values('"+name+"','"+email+"','"+pw+"',false);";
			pool.query(createAccountQuery, (err, data) => {} );
			console.log("Account created!");
		}
		
		res.redirect('/')
	});
});

// Login
router.get('/customer/login', function(req, res, next) {
	res.render('login', { title: 'Log In' });
});

router.post('/customer/login', function(req, res, next) {
	var email = req.body.email;
	var pw = req.body.password;
	
	var loginQuery = "select * from customer where email = '"+email+"' and password = '"+pw+"'";
	
	pool.query(loginQuery, (err, data) => {
		if(data["rowCount"] === 1){
			res.cookie("customer", data["rows"]);
			console.log("Login success!");
		}
		else{
			 console.log("Login failed!");
		}
		
		res.redirect('/')
	});
});

// List reservation
router.get('/customer/reservation', function(req, res, next) {
	console.log(req.cookies);
	let customerCookie = req.cookies.customer[0];
	var getCuisineQuery = "SELECT bk.id AS id, br.name AS name, br.address AS address, bk.pax AS num, bk.throughout AS time FROM booking bk, branch br WHERE bk.branch_id = br.id AND bk.customer_id = '"+customerCookie["id"]+"'";
	pool.query(getCuisineQuery, (err, data) => {
		res.render('reservation', { title: 'Reservation', data: data.rows });
	});
});

const CUISINE_QUERY = `
SELECT id, name
FROM cuisine;
`;
// current limitation in query: connected opening hours as separate entries in db are not considered as a continuous range
const CHOOSE_LOCATION_QUERY = `
SELECT R.id AS restaurant_id, R.restaurant_name AS restaurant_name, B.id AS branch_id, B.name AS branch_name, B.address AS address
FROM branch B
JOIN restaurant R ON (B.restaurant_id = R.id)
JOIN restaurant_cuisine RC ON (R.id = RC.restaurant_id)
WHERE TRUE
AND (RC.cuisine_id = ANY ($1) OR $1 IS NULL)
AND (R.restaurant_name LIKE $2 OR B.name LIKE $2 OR $2 IS NULL)
AND (valid_new_booking(B.id, $4, $3) OR ($3 IS NULL AND $4 IS NULL))
LIMIT 50;
`;
router.get('/customer/chooseLocation', (req, res) => {
	const selectedCuisines = [];
	for (const key in req.query) {
		if (key.startsWith('cuisine-')) {
			selectedCuisines.push(req.query[key]);
		}
	}
	const { filter_name, filter_booking, filter_pax, filter_start, filter_end } = req.query;
	pool.query(CUISINE_QUERY, (err, dbCuisineRes) => {
		const cuisines = dbCuisineRes.rows;
		pool.query(CHOOSE_LOCATION_QUERY,
		[
			selectedCuisines.length > 0 ? selectedCuisines : null,
			filter_name ? '%' + filter_name + '%' : null,
			filter_booking ? filter_pax : null,
			filter_booking ? `[${filter_start},${filter_end}]` : null
		],
		(err, dbLocationRes) => {
			const branches = dbLocationRes.rows;
			res.render('chooseLocation', {
				selectedCuisines,
				filter_name,
				filter_booking,
				filter_pax,
				filter_start,
				filter_end,
				cuisines,
				branches
			});
		})
	})
});

// Reservation (Start)
router.get('/customer/selectCuisine', function(req, res, next) {
	res.redirect('reservation');
});
router.post('/customer/selectCuisine', function(req, res, next) {
	var getCuisineQuery = "SELECT * FROM cuisine";
	pool.query(getCuisineQuery, (err, data) => {
		res.render('selectCuisine', { title: 'Select Cuisine', data: data.rows });
	});
});
// Select restaurant
router.get('/customer/selectRestaurant', function(req, res, next) {
	res.redirect('reservation');
});
router.post('/customer/selectRestaurant', function(req, res, next) {
	var cuisine = req.body.cuisine;

	// TODO: HIDE RESTAURANTS WITHOUT ANY BRANCHES
	var selectRestaurantQuery = "WITH rows AS(SELECT restaurant_id FROM restaurant_cuisine WHERE cuisine_id = '"+cuisine+"') SELECT * FROM restaurant WHERE id = (SELECT * FROM rows)";
	pool.query(selectRestaurantQuery, (err, data) => {
		res.render('selectRestaurant', { title: 'Select Restaurant', data: data.rows });
	});
});

// Select branch
router.get('/customer/selectBranch', function(req, res, next) {
	res.redirect('reservation');
});
router.post('/customer/selectBranch', function(req, res, next) {
	const restaurant_id = req.body.restaurant;
	pool.query(GET_RESTAURANT_BRANCHES_QUERY, [restaurant_id], (err, branchesData) => {
	  if (err) {
	  	console.log(err);
		} else {
      rname = branchesData.rows[0].restaurant_name;
      res.render('selectBranch', { title: 'Select Branch', restaurant_name: rname, data: branchesData.rows });
		}
	});
});


// Reservation (End)
router.get('/customer/makeReservation', function(req, res, next) {
	res.redirect('reservation');
});

router.post('/customer/makeReservation', function(req, res, next) {
	const {branch_id, reservation_pax, reservation_datetime, duration_mins} = req.body;

	const start_time = new Date(reservation_datetime);
  const end_time = new Date(start_time.getTime() + duration_mins * 60 * 1000);

	function get_seconds_in_day(date) {
    return date.getHours() + ":" + date.getMinutes() + ":" + date.getSeconds();
	}

  const availability_data = [branch_id,
  	start_time.getDay(),
  	get_seconds_in_day(start_time),
  	end_time.getDay(),
    get_seconds_in_day(end_time),
		start_time,
		end_time,
		reservation_pax
	];

	console.log("AVAILABLE DATA");
  console.log(availability_data);

	pool.query(CHECK_BRANCH_AVAILABILITY_QUERY, availability_data, (err, data) => {
	  if (err) {
      console.log("error with avail query");
      console.log(err);
		} else {
	  	const hasAvailability = data.rowCount === 1;
		console.log(data);
      if(hasAvailability){
      	const customerId = req.cookies.customer[0].id;
        const make_booking_data = [customerId, branch_id, reservation_pax, start_time, end_time];
        console.log(make_booking_data);

        pool.query(MAKE_BOOKING_QUERY, make_booking_data, (err, data) => {
          if (err) {
            console.log("error with making booking");
            console.log(err);
          } else {
            res.render('makeReservation', { title: 'Booking is done!', data: data.rows });
					}
        });
      } else {
        // TODO: show an error screen for no availability
        console.log("no availability");
			}
		}
	});
});

// Logout
router.get('/customer/logout', function(req, res, next) {
	res.clearCookie('customer');
	res.redirect('/');
	
});
router.get('/customer/logout', function(req, res, next) {
	res.clearCookie('customer');
	res.redirect('/');
});


module.exports = router;

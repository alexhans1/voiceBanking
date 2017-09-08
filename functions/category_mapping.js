module.exports = {

	map: (category_name) => {
		if (category_name === 'Groceries') return '401';
		else if (category_name === 'Clothing') return '391';
		else if (category_name === 'Shopping') return '391';
		else if (category_name === 'Hobbies') return '373';
		else if (category_name === 'Mobility') return '301';
		else if (category_name === 'Transport') return '409';
		else if (category_name === 'Bank') return '333';

		// .....

		else return false;
	}

};

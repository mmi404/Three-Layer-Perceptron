import { Movie, Showtime, Seat } from '../types';

export class MovieFallback {
  static getMovies(): Movie[] {
    return [
      {
        id: 'movie-spiderman',
        title: 'Spider-Man: Brand New Day',
        duration_min: 150,
        rating: 'PG-13',
        is_premiere: true,
        description: 'Peter Parker navigates a fractured multiverse while facing high-stakes adversaries across New York City.',
        poster_url: 'https://images.unsplash.com/photo-1635805737707-575885ab0820?w=600&q=80',
        duration_mins: 150,
        genre: 'Action / Sci-Fi',
        release_date: '2026-08-08',
        imdb_rating: 9.2,
        badge: 'HOT RUSH',
        showtimes: [
          {
            id: 'showtime-spiderman-8pm',
            starts_at: '2026-08-08T20:00:00Z',
            base_price_cents: 45000,
            hall_name: 'Grand Hall IMAX 1',
            theatre_name: 'Star Cineplex CUET',
            screen_name: 'Grand Hall IMAX 1',
            price_amount: 450,
          },
          {
            id: 'showtime-spiderman-1030pm',
            starts_at: '2026-08-08T22:30:00Z',
            base_price_cents: 45000,
            hall_name: 'Dolby Atmos Hall 2',
            theatre_name: 'Star Cineplex CUET',
            screen_name: 'Dolby Atmos Hall 2',
            price_amount: 450,
          },
        ],
      },
      {
        id: 'movie-oppenheimer',
        title: 'Oppenheimer',
        duration_min: 180,
        rating: 'R',
        is_premiere: true,
        description: 'The story of American scientist J. Robert Oppenheimer and his role in the development of the atomic bomb.',
        poster_url: 'https://images.unsplash.com/photo-1440404653325-ab127d49abc1?w=600&q=80',
        duration_mins: 180,
        genre: 'Biography / Drama',
        release_date: '2026-08-07',
        imdb_rating: 8.9,
        badge: 'FEATURED',
        showtimes: [
          {
            id: 'showtime-oppenheimer-7pm',
            starts_at: '2026-08-08T19:00:00Z',
            base_price_cents: 50000,
            hall_name: 'IMAX 70mm Hall',
            theatre_name: 'Star Cineplex CUET',
            screen_name: 'IMAX 70mm Hall',
            price_amount: 500,
          },
        ],
      },
      {
        id: 'movie-avatar-3',
        title: 'Avatar: Fire and Ash',
        duration_min: 192,
        rating: 'PG-13',
        is_premiere: true,
        description: 'Return to Pandora for an epic new journey into uncharted volcanic territories.',
        poster_url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&q=80',
        duration_mins: 192,
        genre: 'Adventure / Sci-Fi',
        release_date: '2026-12-18',
        imdb_rating: 8.8,
        badge: 'IMAX 3D',
        showtimes: [
          {
            id: 'showtime-avatar-830pm',
            starts_at: '2026-08-08T20:30:00Z',
            base_price_cents: 55000,
            hall_name: 'Laser 3D Hall',
            theatre_name: 'Star Cineplex CUET',
            screen_name: 'Laser 3D Hall',
            price_amount: 550,
          },
        ],
      },
      {
        id: 'movie-dune-2',
        title: 'Dune: Part Two',
        duration_min: 166,
        rating: 'PG-13',
        is_premiere: false,
        description: 'Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.',
        poster_url: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&q=80',
        duration_mins: 166,
        genre: 'Action / Sci-Fi',
        release_date: '2024-03-01',
        imdb_rating: 8.6,
        badge: 'IMAX 3D',
        showtimes: [
          {
            id: 'showtime-dune-6pm',
            starts_at: '2026-08-08T18:00:00Z',
            base_price_cents: 45000,
            hall_name: 'Hall 3 Atmos',
            theatre_name: 'Star Cineplex CUET',
            screen_name: 'Hall 3 Atmos',
            price_amount: 450,
          },
        ],
      },
      {
        id: 'movie-deadpool-wolverine',
        title: 'Deadpool & Wolverine',
        duration_min: 128,
        rating: 'R',
        is_premiere: false,
        description: 'Wolverine is recovering from his injuries when he crosses paths with the loudmouth Deadpool.',
        poster_url: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=600&q=80',
        duration_mins: 128,
        genre: 'Action / Comedy',
        release_date: '2024-07-26',
        imdb_rating: 7.8,
        badge: 'HOT RUSH',
        showtimes: [
          {
            id: 'showtime-deadpool-9pm',
            starts_at: '2026-08-08T21:00:00Z',
            base_price_cents: 45000,
            hall_name: 'Hall 4 VIP',
            theatre_name: 'Star Cineplex CUET',
            screen_name: 'Hall 4 VIP',
            price_amount: 450,
          },
        ],
      },
      {
        id: 'movie-dark-knight',
        title: 'The Dark Knight',
        duration_min: 152,
        rating: 'PG-13',
        is_premiere: false,
        description: 'When the menace known as the Joker wreaks havoc and chaos on Gotham, Batman must accept one of the greatest psychological tests.',
        poster_url: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=600&q=80',
        duration_mins: 152,
        genre: 'Action / Crime',
        release_date: '2008-07-18',
        imdb_rating: 9.0,
        badge: 'FEATURED',
        showtimes: [
          {
            id: 'showtime-batman-8pm',
            starts_at: '2026-08-08T20:00:00Z',
            base_price_cents: 40000,
            hall_name: 'Classic Screen 1',
            theatre_name: 'Star Cineplex CUET',
            screen_name: 'Classic Screen 1',
            price_amount: 400,
          },
        ],
      },
      {
        id: 'movie-interstellar',
        title: 'Interstellar',
        duration_min: 169,
        rating: 'PG-13',
        is_premiere: false,
        description: 'When Earth becomes uninhabitable, a team of ex-pilots and scientists travel through a wormhole in search of a new home.',
        poster_url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&q=80',
        duration_mins: 169,
        genre: 'Adventure / Sci-Fi',
        release_date: '2014-11-07',
        imdb_rating: 8.7,
        badge: 'IMAX 3D',
        showtimes: [
          {
            id: 'showtime-interstellar-930pm',
            starts_at: '2026-08-08T21:30:00Z',
            base_price_cents: 45000,
            hall_name: 'Grand Hall IMAX 1',
            theatre_name: 'Star Cineplex CUET',
            screen_name: 'Grand Hall IMAX 1',
            price_amount: 450,
          },
        ],
      },
      {
        id: 'movie-inception',
        title: 'Inception',
        duration_min: 148,
        rating: 'PG-13',
        is_premiere: false,
        description: 'A thief who steals corporate secrets through dream-sharing technology is given the inverse task of planting an idea.',
        poster_url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=600&q=80',
        duration_mins: 148,
        genre: 'Action / Sci-Fi',
        release_date: '2010-07-16',
        imdb_rating: 8.8,
        badge: 'FEATURED',
        showtimes: [
          {
            id: 'showtime-inception-730pm',
            starts_at: '2026-08-08T19:30:00Z',
            base_price_cents: 45000,
            hall_name: 'Hall 2 Dolby',
            theatre_name: 'Star Cineplex CUET',
            screen_name: 'Hall 2 Dolby',
            price_amount: 450,
          },
        ],
      },
    ];
  }

  static getInitialShowtime(): Showtime {
    return {
      id: 'showtime-spiderman-8pm',
      starts_at: '2026-08-08T20:00:00Z',
      base_price_cents: 45000,
      hall_name: 'Grand Hall IMAX 1',
      theatre_name: 'Star Cineplex CUET',
      screen_name: 'Grand Hall IMAX 1',
      price_amount: 450,
      movie_title: 'Spider-Man: Brand New Day',
    };
  }

  static getInitialSeats(): Seat[] {
    const rows = ['A', 'B', 'C', 'D', 'E', 'F'];
    const seatsPerRow = 8;
    const seats: Seat[] = [];

    rows.forEach(r => {
      for (let i = 1; i <= seatsPerRow; i++) {
        const code = `${r}${i}`;
        let status: 'AVAILABLE' | 'HELD' | 'BOOKED' = 'AVAILABLE';

        if (code === 'A3' || code === 'A4' || code === 'C2') {
          status = 'BOOKED';
        }

        seats.push({
          id: `seat-${code.toLowerCase()}`,
          seat_id: `seat-${code.toLowerCase()}`,
          showtime_id: 'showtime-spiderman-8pm',
          seat_code: code,
          row_label: r,
          row: r,
          seat_number: i,
          col: i,
          label: code,
          status,
          price_cents: r <= 'B' ? 56300 : 45000,
          held_by_user_id: null,
          hold_expires_at: null
        });
      }
    });

    return seats;
  }
}

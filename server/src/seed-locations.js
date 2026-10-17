import 'dotenv/config';
import mongoose from 'mongoose';
import { Location } from './models.js';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('Set MONGODB_URI before seeding locations.');
  process.exit(1);
}

const regions = [
  { name: 'Valsad', slug: 'valsad', state: 'Gujarat', places: ['Valsad', 'Vapi', 'Pardi', 'Dharampur', 'Kaprada', 'Nanapondha', 'Umargam'] },
  { name: 'Navsari', slug: 'navsari', state: 'Gujarat', places: ['Navsari', 'Jalalpore', 'Gandevi', 'Chikhli', 'Vansda', 'Khergam'] },
  { name: 'Surat', slug: 'surat', state: 'Gujarat', places: ['Surat', 'Chorasi', 'Olpad', 'Palsana', 'Kamrej', 'Bardoli', 'Mahuva', 'Mandvi', 'Mangrol', 'Umarpada'] },
  { name: 'Dang', slug: 'dang', state: 'Gujarat', places: ['Ahwa'] },
  { name: 'Tapi', slug: 'tapi', state: 'Gujarat', places: ['Vyara', 'Songadh', 'Ukai', 'Valod', 'Uchchhal', 'Dolvan', 'Kukarmunda', 'Nizar'] },
  { name: 'Bharuch', slug: 'bharuch', state: 'Gujarat', places: ['Bharuch', 'Ankleshwar', 'Amod', 'Jambusar', 'Jhagadia', 'Hansot', 'Netrang', 'Vagra', 'Valia'] },
  { name: 'Dadra and Nagar Haveli (UT)', slug: 'dadra-and-nagar-haveli-ut', state: null, places: ['Silvassa', 'Khanvel'] },
  { name: 'Daman (UT)', slug: 'daman-ut', state: null, places: ['Daman'] },
];

const slugify = value => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ensureLocation = async ({ name, slug, type, parent = null }) => Location.findOneAndUpdate(
  { slug, type, parent },
  { $setOnInsert: { name, slug, type, parent, isActive: true } },
  { upsert: true, new: true, setDefaultsOnInsert: true },
);

try {
  await mongoose.connect(uri);
  const states = new Map();
  for (const region of regions) {
    let parent = null;
    if (region.state) {
      if (!states.has(region.state)) {
        states.set(region.state, await ensureLocation({ name: region.state, slug: slugify(region.state), type: 'state' }));
      }
      parent = states.get(region.state)._id;
    }
    const district = await ensureLocation({ name: region.name, slug: region.slug, type: 'district', parent });
    for (const [index, place] of region.places.entries()) {
      await ensureLocation({ name: place, slug: slugify(place), type: index === 0 ? 'city' : 'taluka', parent: district._id });
    }
  }
  console.log(`Location seed complete: ${regions.length} districts/UTs and ${regions.reduce((n, r) => n + r.places.length, 0)} cities/talukas.`);
} finally {
  await mongoose.disconnect();
}

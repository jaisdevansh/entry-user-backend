import { Venue } from '../models/Venue.js';
import { Media } from '../models/Media.js';
import { cacheService } from '../services/cache.service.js';

export const getAllVenues = async (req, res, next) => {
    try {
        const cacheKey = 'venues_all_guest';
        const venues = await cacheService.wrap(cacheKey, 300, async () => {
            return await Venue.find()
                .select('name heroImage venueType address openingTime description images')
                .lean();
        });
        res.status(200).json({ success: true, data: venues });
    } catch (err) { next(err); }
};

export const getVenueById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const venue = await Venue.findById(id).lean();
        if (!venue) return res.status(404).json({ success: false, message: 'Venue not found' });

        // Fetch approved media from this host (photos/videos for the gallery)
        const media = await Media.find({ 
            hostId: venue.hostId, 
            status: 'Approved' 
        })
        .select('url type fileName createdAt')
        .sort({ createdAt: -1 })
        .lean();

        res.status(200).json({ success: true, data: { ...venue, media } });
    } catch (err) { next(err); }
};

export const getVenueProfile = async (req, res, next) => {
    try {
        const venue = await Venue.findOne({ hostId: req.user.id });
        if (!venue) {
            // Return empty venue structure instead of 404 to allow initial creation
            return res.status(200).json({
                success: true,
                data: {
                    name: '',
                    venueType: 'Nightclub',
                    description: '',
                    address: '',
                    capacity: 0,
                    openingTime: '10:00 PM',
                    closingTime: '04:00 AM',
                    rules: '',
                    heroImage: '',
                    images: []
                }
            });
        }
        res.status(200).json({ success: true, data: venue });
    } catch (error) {
        next(error);
    }
};

export const updateVenueProfile = async (req, res, next) => {
    try {
        const {
            name,
            venueType,
            description,
            address,
            capacity,
            openingTime,
            closingTime,
            rules,
            heroImage,
            images,
            coordinates,
            gifts
        } = req.body;


        const venue = await Venue.findOneAndUpdate(
            { hostId: req.user.id },
            {
                name,
                venueType,
                description,
                address,
                capacity,
                openingTime,
                closingTime,
                rules,
                heroImage,
                images,
                coordinates,
                gifts,
                hostId: req.user.id
            },

            { new: true, upsert: true, runValidators: true }
        );

        res.status(200).json({
            success: true,
            message: 'Venue profile updated successfully',
            data: venue
        });
    } catch (error) {
        next(error);
    }
};

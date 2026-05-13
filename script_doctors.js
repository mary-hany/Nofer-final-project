// Doctors with gender-matched photos.
// Augments clinicData.doctors after the main script has populated it.

'use strict';

const doctorImages = {
    male: [
        'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=300&fit=crop&crop=face',
        'https://images.unsplash.com/photo-1624575639382-65487754a2e4?w=300&fit=crop&crop=face',
        'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=300&fit=crop&crop=face'
    ],
    female: [
        'https://images.unsplash.com/photo-1591618241594-0d94c4dbf919?w=300&fit=crop&crop=face',
        'https://images.unsplash.com/photo-1631863703927-5c556b70e211?w=300&fit=crop&crop=face',
        'https://images.unsplash.com/photo-1586046909338-b3f089acdee8?w=300&fit=crop&crop=face'
    ]
};

const femaleNames = ['فاطمة', 'سارة', 'نور', 'هند', 'رنا', 'هبة', 'نوال', 'لمى', 'جود', 'رانيا', 'داليا'];

function getDoctorPhoto(name, id) {
    // Names look like: "د. أحمد محمد" — pull the first given name.
    const parts = (name || '').split(/\s+/);
    const given = parts.length > 1 ? parts[1] : '';
    const isFemale = femaleNames.some(f => given.includes(f));
    const images = isFemale ? doctorImages.female : doctorImages.male;
    return images[(id - 1) % images.length];
}

document.addEventListener('DOMContentLoaded', () => {
    if (!window.clinicData || !Array.isArray(window.clinicData.doctors)) return;
    window.clinicData.doctors.forEach(doctor => {
        doctor.img = getDoctorPhoto(doctor.name, doctor.id);
    });
    // Re-render now that photos are attached
    if (typeof window.renderDoctors === 'function') window.renderDoctors();
});

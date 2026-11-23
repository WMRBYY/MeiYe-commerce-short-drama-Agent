/** 视频复刻 / 剧本创作左侧功能卡的封面：用站内已有的真实示例照片，一眼看出这个功能做什么。 */
const I = (name: string) => `/inspiration-thumbs/haohaoxue/${name}.webp`;

export const VIDEO_KIND_COVERS: Record<string, string> = {
    model: "/images/video-guides/model.jpg",
    clothing: I("japanese-street-fashion"),
    face: "/images/video-guides/face.jpg",
    background: "/images/video-guides/background.jpg",
    product: "/images/video-guides/product.jpg",
    "precise-product": I("headphones-editorial-product"),
    "precise-person": I("headshot-editorial-male"),
    combination: I("sneaker-campaign-ad"),
    dance: I("sportswear-technical-shoot"),
};

export const SCRIPT_FORMAT_COVERS: Record<string, string> = {
    "drama-commerce": I("slice-of-life-school"),
    free: I("surreal-dreamscape"),
    "creative-planning": I("retro-film-collage"),
    "talking-sell": I("cosmetics-brand-campaign"),
    promo: I("luxury-gift-packaging"),
    "scene-seed": I("skincare-flatlay"),
    "pain-solve": I("liquid-splash-product"),
    demo: I("tech-product-launch-brand"),
    "store-discover": I("ramen-shop-steam"),
    "store-visit": I("chinese-teahouse-portrait"),
    signature: I("hyperrealistic-food-photo"),
    "group-deal": I("nightmarket-street-portrait"),
    "brand-manifesto": I("minimal-luxury-brand"),
    "brand-story": I("cultural-institution-brand"),
    lifestyle: I("resort-vacation-fashion"),
    "brand-concept": I("retro-film-collage"),
    dialogue: I("slice-of-life-school"),
    twist: I("film-noir-portrait"),
    suspense: I("businessman-keyboard-shanghai-night"),
    emotion: I("rain-window-portrait"),
    placement: I("headphones-editorial-product"),
    sitcom: I("slice-of-life-school"),
};

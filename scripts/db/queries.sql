SELECT "user".username, "user".id, post_1.title, post_1.body, post_1.id AS id_1, post_1.user_id
FROM "user"
    LEFT OUTER JOIN post AS post_1 ON "user".id = post_1.user_id
ORDER BY "user".id

SELECT "user".username, "user".id FROM "user" ORDER BY "user".id

SELECT
    post.user_id AS post_user_id,
    post.title AS post_title,
    post.body AS post_body,
    post.id AS post_id
FROM post

SELECT post.title, post.body, post.id, post.user_id, user_1.username, user_1.id AS id_1
FROM post
    LEFT OUTER JOIN "user" AS user_1 ON user_1.id = post.user_id
ORDER BY post.id

SELECT "user".username, "user".id, profile_1.first_name, profile_1.last_name, profile_1.bio, profile_1.id AS id_1, profile_1.user_id
FROM "user"
    LEFT OUTER JOIN profile AS profile_1 ON "user".id = profile_1.user_id
ORDER BY "user".id

SELECT
    post.user_id AS post_user_id,
    post.title AS post_title,
    post.body AS post_body,
    post.id AS post_id
FROM post
WHERE
    post.user_id IN (
        $1::INTEGER,
        $2::INTEGER,
        $3::INTEGER
    )

SELECT profile.first_name, profile.last_name, profile.bio, profile.id, profile.user_id, user_1.username, user_1.id AS id_1
FROM profile
    LEFT OUTER JOIN "user" AS user_1 ON user_1.id = profile.user_id
ORDER BY profile.id

SELECT
    post.user_id AS post_user_id,
    post.title AS post_title,
    post.body AS post_body,
    post.id AS post_id
FROM post
WHERE
    post.user_id IN (
        $1::INTEGER,
        $2::INTEGER,
        $3::INTEGER
    )
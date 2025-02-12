import { createRouter, createWebHashHistory, START_LOCATION } from 'vue-router';
import Home from '../views/Home.vue';

const routes = [
  {
    path: '/',
    name: 'home',
    component: Home,
  },
  {
    path: '/about',
    name: 'about',
    component: () => import(/* webpackChunkName: "about" */ '../views/About.vue')
  },
];

const router = createRouter({
  history: createWebHashHistory(process.env.BASE_URL),
  routes
});

createRouter({
  history: createWebHashHistory(),
  routes
});

router.beforeEach((to,from, next) => {
  if(from === START_LOCATION){
    next('/motomo');
  }
});

export default router;
